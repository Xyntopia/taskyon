import { serializeObject } from '@taskyon/common/modules/serializeObject'
import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  SystemModelMessage,
  Tool,
  ToolModelMessage,
  ToolResultPart,
  ToolSet,
  UserModelMessage,
} from 'ai'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7 } from 'json-schema'
import {
  createTaskVariablePresentationService,
  extractTaskRefsFromValue,
  materializeTaskyonFunctionArguments,
  renderTaskyonVariableBlock,
} from '../../core/taskVariables'
import { mapFunctionNames } from '../../core/tools'
import { toPromptMessages, type PromptInjection } from '../../llm/promptMessages'
import type { FileAttachment, TaskGetter, TaskNode } from '../../types/taskNode'
import type { ToolBase } from '../../types/tools'
import { charHash } from '../../utils/crypto'
import { humanizeError } from '../../utils/error'
import { convertFileToText } from '../../utils/loadFiles'
import { isEmpty } from '../../utils/objHelpers'

const augmentToolSchemaForTaskyonVariables = (schema: JSONSchema7) => {
  if (schema.type !== 'object') return schema

  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      $use: {
        type: 'object',
        description:
          'Taskyon extension. Map argument paths to visible task variables when a whole argument should come from a previous task result.',
        additionalProperties: {
          type: 'string',
        },
        examples: [{ document: 'python1' }],
      },
    },
  } satisfies JSONSchema7
}

const convertToChatCompletionTool = (definition: ToolBase): Tool =>
  tool({
    title: definition.name,
    description: `${definition.description}\n\nTaskyon note: whole arguments may use the reserved $use mapping to reference previous task results.`,
    inputSchema: jsonSchema(augmentToolSchemaForTaskyonVariables(definition.parameters)),
  })

const generateToolDeclarations = (
  allowedTools: string[],
  toolDefinitions: Record<string, ToolBase>,
) =>
  (mapFunctionNames(allowedTools, toolDefinitions) ?? []).reduce<ToolSet>(
    (tools, definition) => ({
      ...tools,
      [definition.name]: convertToChatCompletionTool(definition),
    }),
    {},
  )

export const prepareChatCompletionContext = async (input: {
  taskChain: TaskNode[]
  allowedTools: string[]
  toolDefinitions: Record<string, ToolBase>
  appendSystemPrompts: string[]
  prependSystemPrompts: PromptInjection[]
  useVisionModels: boolean
  getArtifact?: (attachment: FileAttachment | string) => Promise<File | undefined>
  getTaskById: TaskGetter
}) => {
  const variableService = createTaskVariablePresentationService()
  const taskMessages = await convertTaskNodesToOpenAIChat(
    input.taskChain,
    input.getArtifact,
    input.useVisionModels,
    input.allowedTools.length > 0,
    input.toolDefinitions,
    {
      getTaskById: input.getTaskById,
      variableService,
    },
  )
  const promptMessages = toPromptMessages(input.appendSystemPrompts, input.prependSystemPrompts)
  const messages = [
    ...promptMessages.prependMessages,
    ...taskMessages,
    ...promptMessages.appendMessages,
  ]

  if (messages.length === 0) {
    throw new Error('We were not able to convert our tasks into an AI-compatible format!')
  }

  return {
    messages,
    tools:
      input.allowedTools.length > 0
        ? generateToolDeclarations(input.allowedTools, input.toolDefinitions)
        : {},
    variableService,
  }
}

const ensureToolResponses = (messages: ModelMessage[]) => {
  const responded = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool' && message.content[0]?.type === 'tool-result') {
      responded.add(message.content[0].toolCallId)
    }
  }

  const result: ModelMessage[] = []
  for (const message of messages) {
    result.push(message)
    if (message.role !== 'assistant') continue

    for (const content of message.content) {
      if (
        typeof content !== 'string' &&
        content.type === 'tool-call' &&
        !responded.has(content.toolCallId)
      ) {
        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: content.toolCallId,
              toolName: content.toolName,
              output: { type: 'text', value: 'No response was recorded from the tool.' },
            },
          ],
        })
        responded.add(content.toolCallId)
      }
    }
  }

  return result
}

export async function convertTaskNodesToOpenAIChat(
  taskChain: TaskNode[],
  getArtifact: ((attachment: FileAttachment | string) => Promise<File | undefined>) | undefined,
  tryUsingVisionModels: boolean,
  useNativeTools: boolean,
  toolDefinitions: Record<string, ToolBase>,
  options?: {
    getTaskById?: TaskGetter
    variableService?: ReturnType<typeof createTaskVariablePresentationService>
  },
) {
  const tasksById = new Map<string, TaskNode>(taskChain.map((task) => [task.id, task]))
  const variableService = options?.variableService ?? createTaskVariablePresentationService()
  const getTaskById: TaskGetter =
    options?.getTaskById ?? ((taskId: string) => Promise.resolve(tasksById.get(taskId) ?? null))
  const renderedTaskIds = new Set<string>()
  const injectedTaskIds = new Set<string>()
  const messages: ModelMessage[] = []

  for (const task of taskChain) {
    messages.push(
      ...(await renderMissingReferencedTasksForLlm(
        task,
        tasksById,
        renderedTaskIds,
        injectedTaskIds,
        variableService,
        getTaskById,
      )),
    )

    const renderedMessages = await convertTaskNodeToOpenAIMessage(
      task,
      tasksById,
      tryUsingVisionModels,
      getArtifact,
      useNativeTools,
      toolDefinitions,
      variableService,
      getTaskById,
    )
    if (renderedMessages?.length) messages.push(...renderedMessages)
    renderedTaskIds.add(task.id)
  }

  return ensureToolResponses(messages)
}

const renderTaskContentForLlm = (
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  variableService: ReturnType<typeof createTaskVariablePresentationService>,
) => {
  const variableName = variableService.getOrAssignVariableName(task, tasksById)
  const content =
    task.content.type === 'message'
      ? String(task.content.data)
      : serializeObject(task.content.data, {
          format: 'yaml',
          maxDepth: 5,
          maxArrayLength: 40,
          maxObjectKeys: 40,
          maxStringLength: 16_000,
          includeTruncationNotice: true,
        })
  return renderTaskyonVariableBlock(variableName, content)
}

const renderMissingReferencedTasksForLlm = async (
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  renderedTaskIds: Set<string>,
  injectedTaskIds: Set<string>,
  variableService: ReturnType<typeof createTaskVariablePresentationService>,
  getTaskById: TaskGetter,
) => {
  const refs = extractTaskRefsFromValue(task.content.data)
  const injectedMessages: SystemModelMessage[] = []

  for (const taskId of refs) {
    if (renderedTaskIds.has(taskId) || injectedTaskIds.has(taskId)) continue
    const referencedTask = tasksById.get(taskId) ?? (await getTaskById(taskId))
    if (!referencedTask) {
      throw new Error(`Taskyon variable reference points to missing task ${taskId}`)
    }
    tasksById.set(taskId, referencedTask)
    injectedTaskIds.add(taskId)
    injectedMessages.push({
      role: 'system',
      content: renderTaskContentForLlm(referencedTask, tasksById, variableService),
    })
  }

  return injectedMessages
}

const convertTaskNodeToOpenAIMessage = async (
  task: TaskNode,
  tasksById: Map<string, TaskNode>,
  useVisionModels: boolean,
  getArtifact: ((attachment: FileAttachment | string) => Promise<File | undefined>) | undefined,
  useNativeTools: boolean,
  toolCollection: Record<string, ToolBase>,
  variableService: ReturnType<typeof createTaskVariablePresentationService>,
  getTaskById: TaskGetter,
  maxToolIdLength = 9,
): Promise<ModelMessage[] | undefined> => {
  if (task.content.type === 'functioncall') {
    const functionCallName = task.content.data.name
    if (toolCollection[functionCallName]?.renderOptions?.hideLlm) return

    const llmArguments = await materializeTaskyonFunctionArguments(task.content.data.arguments, {
      surface: 'llm',
      getTaskById,
      variableService,
      tasksById,
    })
    if (useNativeTools) {
      return [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: await charHash(task.id, maxToolIdLength),
              toolName: functionCallName,
              input: llmArguments,
            },
          ],
        } satisfies AssistantModelMessage,
      ]
    }

    return [
      {
        role: 'assistant',
        content:
          `The following tool was used: ${functionCallName}.` +
          (!isEmpty(llmArguments)
            ? ` The function arguments were: ${serializeObject(llmArguments, {
                format: 'json',
                maxDepth: 6,
                maxArrayLength: 40,
                maxObjectKeys: 40,
                maxStringLength: 12_000,
                includeTruncationNotice: true,
              })}`
            : ''),
      },
    ]
  }

  if (task.content.type === 'toolresult') {
    const renderedBlock = renderTaskyonVariableBlock(
      variableService.getOrAssignVariableName(task, tasksById),
      serializeObject(task.content.data, {
        format: 'yaml',
        maxDepth: 6,
        maxArrayLength: 60,
        maxObjectKeys: 60,
        maxStringLength: 20_000,
        includeTruncationNotice: true,
      }),
    )
    const toolCallTask = task.parentID ? tasksById.get(task.parentID) : undefined
    const parentToolName =
      toolCallTask?.content.type === 'functioncall' ? toolCallTask.content.data.name : undefined
    const parentToolVisibleToLlm =
      parentToolName !== undefined && !toolCollection[parentToolName]?.renderOptions?.hideLlm

    if (
      task.parentID &&
      useNativeTools &&
      toolCallTask?.content.type === 'functioncall' &&
      parentToolVisibleToLlm
    ) {
      const output: ToolResultPart['output'] = {
        type: 'text',
        value: renderedBlock,
      }
      return [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: await charHash(task.parentID, maxToolIdLength),
              toolName: toolCallTask.content.data.name,
              output,
            },
          ],
        } satisfies ToolModelMessage,
      ]
    }

    return [{ role: 'system', content: renderedBlock }]
  }

  if (task.content.type === 'message' && task.role !== 'function') {
    return [
      {
        role: task.role,
        content: renderTaskyonVariableBlock(
          variableService.getOrAssignVariableName(task, tasksById),
          task.content.data,
        ),
      },
    ]
  }

  if (task.content.type === 'error') {
    return [
      {
        role: 'system',
        content: renderTaskyonVariableBlock(
          variableService.getOrAssignVariableName(task, tasksById),
          humanizeError(task.content.data),
        ),
      },
    ]
  }

  if (task.content.type === 'structured') {
    return [
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: renderTaskyonVariableBlock(
              variableService.getOrAssignVariableName(task, tasksById),
              serializeObject(task.content.data, {
                format: 'yaml',
                maxDepth: 6,
                maxArrayLength: 50,
                maxObjectKeys: 50,
                maxStringLength: 16_000,
                includeTruncationNotice: true,
              }),
            ),
          },
        ],
      } satisfies AssistantModelMessage,
    ]
  }

  if (task.content.type === 'files') {
    const attachments = await resolveFileAttachments(task.content.data, getArtifact)
    const fileNames = attachments
      .map(({ reference, file }) => {
        const name =
          typeof reference === 'string' ? (file?.name ?? 'Unknown uploaded file') : reference.name
        return `- ${name}${file ? '' : ' (attachment unavailable)'}`
      })
      .join('\n')
    const systemMessage: SystemModelMessage = {
      role: 'system',
      content: `User uploaded files:\n${fileNames}`,
    }
    const fileContent = await makeFilesAiReadable(attachments, useVisionModels)

    return fileContent.length > 0
      ? [systemMessage, { role: 'user', content: fileContent } satisfies UserModelMessage]
      : [systemMessage]
  }
}

const fileToBase64 = async (file: File) => {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  const base64 = btoa(binary)
  if (base64.startsWith('data:')) {
    throw new Error('fileToBase64 returned a data URL, expected raw base64 only')
  }
  return base64
}

type ResolvedFileAttachment = {
  reference: FileAttachment | string
  file: File | undefined
}

const resolveFileAttachments = async (
  attachments: readonly (FileAttachment | string)[],
  getFile: ((attachment: FileAttachment | string) => Promise<File | undefined>) | undefined,
): Promise<ResolvedFileAttachment[]> =>
  await Promise.all(
    attachments.map(async (reference) => ({
      reference,
      file: getFile ? await getFile(reference).catch(() => undefined) : undefined,
    })),
  )

const makeFilesAiReadable = async (
  attachments: readonly ResolvedFileAttachment[],
  nativeModelProcessing: boolean,
) => {
  const fileContent: (FilePart | ImagePart)[] = []
  for (const { reference, file } of attachments) {
    if (!file) continue
    const name = typeof reference === 'string' ? file.name : reference.name
    const lowerName = name.toLowerCase()

    if (/\.(png|jpe?g|gif|webp)$/i.test(lowerName) && nativeModelProcessing) {
      const base64 = await fileToBase64(file)
      fileContent.push({
        type: 'image',
        mediaType: file.type,
        image: `data:${file.type};base64,${base64}`,
      })
    } else if (/\.(wav|mp3)$/i.test(lowerName) && nativeModelProcessing) {
      fileContent.push({
        type: 'file',
        mediaType: lowerName.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
        data: await fileToBase64(file),
      })
    } else if (/\.pdf$/i.test(lowerName) && nativeModelProcessing) {
      const mediaType = file.type || 'application/pdf'
      fileContent.push({
        type: 'file',
        mediaType,
        data: `data:${mediaType};base64,${await fileToBase64(file)}`,
        filename: name,
      })
    } else {
      try {
        const text = await convertFileToText(file)
        fileContent.push({
          type: 'file',
          mediaType: 'text/plain',
          data: `Contents of file: ${name}\n\n'''${text}'''`,
        })
      } catch (error) {
        fileContent.push({
          type: 'file',
          mediaType: 'text/plain',
          data: `Skipping unsupported file type: ${name}`,
        })
        console.warn(`Skipping unsupported file type for OpenAI: ${name}`, error)
      }
    }
  }
  return fileContent
}
