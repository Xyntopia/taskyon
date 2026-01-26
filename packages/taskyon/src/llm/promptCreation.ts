import type { ModelMessage } from 'ai'
import { z } from 'zod'
import { summarizeTools } from '../core/tools'
import type { ToolBase } from '../types/tools'
import { FunctionCall } from '../types/tools'
import { safeYamlDump, zodToYamlString } from '../utils/yamlUtils'

const answer = z.string()
const yesno = z.enum(['yes', 'no']).or(z.boolean()).nullable()
type yesno = z.infer<typeof yesno>

// TODO: don't add more "goals" to this list, we want chatCompletion to figure
//       out the goals dynamically trough the parameters we provide and the messages coming before it...
//       in fact in the future we would like to get rid of this part and provide all of this
//       functionality with different tools while utilizing a very "slim" chatCompletion
export type Goals =
  | 'SimpleCompletion'
  | 'AnalyzeError'
  | 'ChooseTool'
  | 'AnalyzeToolResult'
  | 'WebSearch'

// this one here is important. It should be as simple as possible
// this type is used to parse & describe tool commands
// an LLM should be able to generate this content...
export const UseToolBase = z.object({
  'use tool': yesno,
  'which tool': answer,
  command: FunctionCall.nullish().meta({
    description:
      'If we should use a tool in the following step, provide the tool command. Otherwise do not!!',
  }),
})

const SystemResponseEvaluation = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'do you think we can solve the error?': yesno,
    'Would it help to use one of the mentioned tools to solve the issue?': yesno,
    'Should we try to correct the error': yesno,
    'try again': yesno,
  })
  .meta({
    description:
      'This is used as a short prompt for tasks in order to determine whether we should use a more detailed task prompt',
  })

const ToolResultBase = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'was the tool call successfull?': answer.or(yesno),
    'should we use a different tool?': answer.or(yesno),
    'should we use different parameters': yesno,
    'try again': yesno,
  })
  .meta({
    description: 'Structured answer schema for processing the result of a function call.',
  })

const ToolSelection = z
  .object({
    'Do we have to use a tool?': yesno,
    'describe your thoughts': answer,
  })
  .meta({
    description: 'Structured answer schema for a task including the use of tools',
  })

export const StructuredResponseTypes = {
  ToolResultBase,
  ToolSelection,
  SystemResponseEvaluation,
}
export const StructuredResponse = ToolResultBase.partial()
  .merge(ToolSelection.partial())
  .merge(SystemResponseEvaluation.partial())
  .merge(UseToolBase.partial())
export type StructuredResponse = z.infer<typeof StructuredResponse>

function substituteStringVariables(variables: Record<string, string>, content: string) {
  return Object.entries(variables).reduce(
    (acc, [variableKey, variableValue]) =>
      acc.replace(new RegExp(`{${variableKey}}`, 'g'), variableValue),
    content,
  )
}

// gets all the function calls in an openai conversation and makes a list from that :)
function getAllFunctionsInOpenAiConversation(
  modifiedOpenAIConversationThread: readonly ModelMessage[],
): Set<string> {
  return modifiedOpenAIConversationThread.reduce((acc, msg) => {
    if (msg.role === 'tool') {
      msg.content.forEach((c) => {
        if (c.type === 'tool-result') {
          acc.add(c.toolName)
        }
      })
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      msg.content.forEach((c) => {
        if (c.type === 'tool-call') {
          acc.add(c.toolName)
        }
      })
    }

    return acc
  }, new Set<string>())
}

const string2OpenAiMessage =
  (variables: Record<string, string>) => (role: string) => (msgList: string[]) =>
    msgList.map((prompt) => ({
      role,
      content: substituteStringVariables(variables, prompt),
    })) as ModelMessage[]

function calculateCompletionVariables(
  allowedTools: string[],
  useToolChat: boolean,
  lastMessage: unknown,
  goal: string | undefined,
  toolCollection: Record<string, ToolBase>,
) {
  const originalMessage = typeof lastMessage !== 'string' ? safeYamlDump(lastMessage) : lastMessage

  const requiredSchema =
    goal === 'AnalyzeError'
      ? useToolChat
        ? StructuredResponseTypes.SystemResponseEvaluation.merge(UseToolBase)
        : StructuredResponseTypes.SystemResponseEvaluation
      : goal === 'ChooseTool'
        ? StructuredResponseTypes.ToolSelection.merge(UseToolBase)
        : goal === 'AnalyzeToolResult'
          ? useToolChat
            ? StructuredResponseTypes.ToolResultBase.merge(UseToolBase)
            : StructuredResponseTypes.ToolResultBase
          : undefined

  const variables = {
    format: 'yaml',
    message: originalMessage,
    schema: requiredSchema ? zodToYamlString(requiredSchema) : '<No schema specified>',
    tools: summarizeTools(allowedTools || [], toolCollection, false, true),
  }
  return variables
}

// enhance the chat by inserting prompts before certain message which
// make them better to understand for the AI...
export function addPrompts(
  toolCollection: Record<string, ToolBase>,
  useNativeTools: boolean,
  nativeStructuredResponse: boolean,
  useBasePrompt: boolean,
  taskChatTemplates: {
    basePrompt: string
    evaluate: string
    instruction: string
    tools: string
    task: string
    schemaReminder: string
    toolResult: string
  },
  chatCompletionMessages: ModelMessage[],
  prompts: string[],
  allowedTools: string[],
  lastMessage: unknown,
  goal?: Goals,
  schema?: Record<string, unknown>,
) {
  // Check if task has tools and OpenAI tools are not enabled
  //console.log('Creating chat prompts');
  const useToolChat = allowedTools.length > 0 && !useNativeTools

  const variables = calculateCompletionVariables(
    allowedTools,
    useToolChat,
    lastMessage,
    goal,
    toolCollection,
  )

  // override our schema variable if one was given explicitly
  if (schema) {
    variables.schema = safeYamlDump({ schemaType: 'json schema', ...schema })
  }

  const modifiedOpenAIConversationThread = structuredClone(chatCompletionMessages)
  const prependMessagesList: string[] = []
  const appendMessagesList: string[] = []
  const appendSystemMessage: string[] = []

  // we always prepend our "fancy" prompt, if we use "native" tools...
  if ((goal === 'SimpleCompletion' && useBasePrompt) || useNativeTools || goal === 'WebSearch') {
    prependMessagesList.unshift(taskChatTemplates.basePrompt)

    if (!useNativeTools) {
      const calledFunctions = getAllFunctionsInOpenAiConversation(modifiedOpenAIConversationThread)
      // if any tools appeared during the conversation...
      if (calledFunctions.size > 0) {
        // this one is used, if we don't need to choose a tool, but it is necessary for the AI to know that a result
        // that it has access to was calculated by a tool.
        const functionCallDescription = summarizeTools([...calledFunctions], toolCollection, true)
        const toolAwareness = `You have access to and used the following tools: \n\n ${functionCallDescription}`

        prependMessagesList.push(toolAwareness)
      }
    }
  }
  if (goal && goal !== 'SimpleCompletion' && goal !== 'WebSearch') {
    // only add tools, if we don#t use the native API already
    if (!useNativeTools) {
      appendMessagesList.push(taskChatTemplates.instruction, taskChatTemplates.tools)
      // send instructions only if there aren't any custom prompts...
      if (prompts.length === 0) {
        // Remove the last message from openAIConversationThread
        // because it will be replaced by our task/evaluate/toolResult messages
        // where we have wrapped the original message...
        modifiedOpenAIConversationThread.pop()
        if (goal === 'AnalyzeError') {
          appendMessagesList.push(taskChatTemplates.evaluate)
        } else if (goal === 'ChooseTool') {
          appendMessagesList.push(taskChatTemplates.task)
        } else if (goal === 'AnalyzeToolResult') {
          appendMessagesList.push(taskChatTemplates.toolResult)
        }
      }
    }
    // put custom prompts between general instruction, tool lists and
    // the schema enforcer
    appendMessagesList.push(...prompts)
    if (!useNativeTools) appendSystemMessage.push(taskChatTemplates.schemaReminder)
  } else {
    appendMessagesList.push(...prompts)
    if (schema && !nativeStructuredResponse) {
      appendSystemMessage.push(taskChatTemplates.schemaReminder)
    }
  }

  const converter = string2OpenAiMessage(variables)

  const prependMessages = converter('system')(prependMessagesList)
  const appendMessages = converter('system')(appendMessagesList)
  appendMessages.push(...converter('system')(appendSystemMessage))

  // build our complete thread :)
  return { prependMessages, modifiedOpenAIConversationThread, appendMessages }
}
