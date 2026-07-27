import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { tyCore } from '../core/init'
import { createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import { createTaskyonClient } from '../api'
import { createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { createStandardEntryNodeTool, normalizeEntryNodeSettings } from '../tools/entryNode'
import { createDefaultTaskyonToolSetup } from '../tools'
import { CLARIFICATION_TOOL_NAME } from '../tools/clarificationTool'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'
import {
  buildLinkedTaskChain,
  resolveDiagnosticsRuntimeConfig,
} from '../testSupport/onlineProviderSupport'
import { FunctionCall } from '../types/tools'
import { humanizeError } from '../utils/error'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testEntryNodeDefaultsNullTaskContractResultToMessage = () => {
  const normalized = normalizeEntryNodeSettings({
    taskContract: {
      objective: 'Use the clock tool.',
      result: null,
    } as never,
  })

  assert(
    normalized.taskContract?.result.mode === 'message',
    'Expected a null provider-generated task result contract to default to message mode.',
  )
  return { success: true }
}
testEntryNodeDefaultsNullTaskContractResultToMessage.description =
  'Defaults a provider-generated null task contract result to message mode before entry-node execution.'

export const testEntryNodeNormalizesScalarMessageTaskContractResult = () => {
  const normalized = normalizeEntryNodeSettings({
    taskContract: {
      objective: 'Use the clock tool.',
      result: 'message',
    } as never,
  })

  assert(
    normalized.taskContract?.result.mode === 'message',
    'Expected a provider-generated scalar message result to normalize to message mode.',
  )
  return { success: true }
}
testEntryNodeNormalizesScalarMessageTaskContractResult.description =
  'Normalizes a provider-generated scalar message task result before entry-node execution.'

const getFunctionCall = (task: unknown): FunctionCall | undefined => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? FunctionCall.parse(content.data) : undefined
}

export const testEntryNodePropagatesTaskContractWithoutPromptDuplication = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash'],
    toolChooser: { enabled: false },
  })
  const completionCriterion = 'Every trust boundary has an evidence note.'
  const taskContract = {
    objective: 'Audit the authentication boundary.',
    agentInstructions: 'Act as a cybersecurity reviewer.',
    doneWhen: [completionCriterion],
    result: { mode: 'message' as const },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: {
        type: 'message',
        data: [
          'Task objective:',
          taskContract.objective,
          '',
          'Complete when:',
          `- ${completionCriterion}`,
        ].join('\n'),
      },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: { taskContract },
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    {
      taskContract,
      providerToolCalling: false,
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-task-contract-test',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a continuation chain',
  )
  const continuation = result.taskChainList[0]
  const chatCompletionCall = getFunctionCall(continuation?.[0])
  const chatArguments = chatCompletionCall?.arguments
  const appendedPrompts =
    chatArguments &&
    typeof chatArguments === 'object' &&
    'appendSystemPrompts' in chatArguments &&
    Array.isArray(chatArguments.appendSystemPrompts)
      ? chatArguments.appendSystemPrompts.join('\n')
      : ''

  assert(
    !appendedPrompts.includes(taskContract.objective) &&
      !appendedPrompts.includes(taskContract.agentInstructions) &&
      !appendedPrompts.includes(completionCriterion),
    'Expected entryNode prompts not to duplicate visible task-contract information',
  )
  assert(
    continuation?.length === 1 &&
      chatArguments &&
      typeof chatArguments === 'object' &&
      Array.isArray(chatArguments.allowedTools) &&
      chatArguments.allowedTools.length === 1 &&
      chatArguments.allowedTools[0] === 'entryNode' &&
      chatArguments.toolChoice &&
      typeof chatArguments.toolChoice === 'object' &&
      !Array.isArray(chatArguments.toolChoice) &&
      chatArguments.toolChoice.toolName === 'entryNode' &&
      !('schema' in chatArguments) &&
      !('resultMode' in chatArguments),
    'Expected the decision completion to expose and force only the entryNode tool',
  )

  return { success: true }
}

export const testEntryNodeForwardsContractedResultSchema = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [],
    toolChooser: { enabled: false },
  })
  const resultSchema = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      findings: { type: 'array' as const, items: { type: 'string' as const } },
    },
    required: ['findings'],
  }
  const taskContract = {
    objective: 'Review the authentication boundary.',
    result: {
      mode: 'structured' as const,
      schema: resultSchema,
    },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: `Task objective:\n${taskContract.objective}` },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: { taskContract } },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    { taskContract },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-contracted-result-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a contracted chat completion',
  )

  const chatCompletionCall = getFunctionCall(result.taskChainList[0]?.[0])
  const chatArguments = chatCompletionCall?.arguments
  assert(
    chatArguments &&
      typeof chatArguments === 'object' &&
      'schema' in chatArguments &&
      JSON.stringify(chatArguments.schema) === JSON.stringify(resultSchema) &&
      !('resultMode' in chatArguments),
    'Expected entryNode to forward the contract schema through the existing chatCompletion interface',
  )

  return { success: true }
}

export const testEntryNodeHonorsExplicitAllowedToolRestrictions = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [
      'bash',
      'taskSearcher',
      'gitlab',
      'downloadFile',
      'taskPlanner',
      'askClarifyingQuestions',
    ],
    getToolCatalog: () =>
      Promise.resolve([
        { name: 'bash', description: 'Run a shell command.' },
        { name: 'taskSearcher', description: 'Search prior tasks.' },
        { name: 'gitlab', description: 'Use the GitLab API.' },
        { name: 'downloadFile', description: 'Download a file.' },
        { name: 'taskPlanner', description: 'Plan multi-step work.' },
        { name: 'askClarifyingQuestions', description: 'Ask blocking questions.' },
      ]),
    toolChooser: { enabled: true, useTools: true },
  })
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: 'Summarize the prior handoff.' },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: { name: 'entryNode', arguments: {} },
      },
    },
  ]
  const context = {
    getExecutionTaskChain: () => Promise.resolve(taskChain),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'entry-node-allowed-tools-test',
  }

  const shortlistResult = await entryNodeTool.function?.({}, context)
  assert(
    shortlistResult && typeof shortlistResult === 'object' && 'taskChainList' in shortlistResult,
    'Expected entryNode to create a shortlist continuation',
  )
  const shortlistContinuation = shortlistResult.taskChainList[0]
  const shortlistArguments = getFunctionCall(shortlistContinuation?.[0])?.arguments
  assert(
    shortlistContinuation?.length === 1 &&
      shortlistArguments &&
      typeof shortlistArguments === 'object' &&
      Array.isArray(shortlistArguments.allowedTools) &&
      shortlistArguments.allowedTools.length === 1 &&
      shortlistArguments.allowedTools[0] === 'entryNode' &&
      shortlistArguments.toolChoice &&
      typeof shortlistArguments.toolChoice === 'object' &&
      !Array.isArray(shortlistArguments.toolChoice) &&
      shortlistArguments.toolChoice.toolName === 'entryNode' &&
      !('schema' in shortlistArguments) &&
      !('resultMode' in shortlistArguments),
    'Expected shortlist chatCompletion to expose and force only the entryNode tool',
  )

  const noToolsResult = await entryNodeTool.function?.({ allowedTools: [] }, context)
  assert(
    noToolsResult && typeof noToolsResult === 'object' && 'taskChainList' in noToolsResult,
    'Expected entryNode to create a tool-free continuation',
  )
  const noToolsArguments = getFunctionCall(noToolsResult.taskChainList[0]?.[0])?.arguments
  assert(
    noToolsArguments &&
      typeof noToolsArguments === 'object' &&
      !('allowedTools' in noToolsArguments),
    'Expected an explicit empty allowedTools override not to fall back to default tools',
  )

  const bashOnlyResult = await entryNodeTool.function?.({ allowedTools: ['bash'] }, context)
  assert(
    bashOnlyResult && typeof bashOnlyResult === 'object' && 'taskChainList' in bashOnlyResult,
    'Expected entryNode to create a restricted continuation',
  )
  const bashOnlyArguments = getFunctionCall(bashOnlyResult.taskChainList[0]?.[0])?.arguments
  assert(
    bashOnlyArguments &&
      typeof bashOnlyArguments === 'object' &&
      'allowedTools' in bashOnlyArguments &&
      Array.isArray(bashOnlyArguments.allowedTools) &&
      bashOnlyArguments.allowedTools.length === 1 &&
      bashOnlyArguments.allowedTools[0] === 'bash',
    'Expected allowedTools to filter the configured tool catalog',
  )

  const postToolResult = await entryNodeTool.function?.(
    { allowedTools: ['bash'] },
    {
      ...context,
      getExecutionTaskChain: () =>
        Promise.resolve([
          taskChain[0] as TaskNode,
          taskChain[1] as TaskNode,
          {
            id: 'bash-call',
            role: 'function',
            parentID: 'entry-node',
            content: { type: 'functioncall', data: { name: 'bash', arguments: {} } },
          },
          {
            id: 'bash-result',
            role: 'system',
            parentID: 'bash-call',
            content: { type: 'toolresult', data: { stdout: 'done' } },
          },
          {
            id: 'post-tool-entry',
            role: 'function',
            priorID: 'bash-result',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
        ]),
    },
  )
  assert(
    postToolResult && typeof postToolResult === 'object' && 'taskChainList' in postToolResult,
    'Expected entryNode to continue after a tool result',
  )
  const postToolArguments = getFunctionCall(postToolResult.taskChainList[0]?.[0])?.arguments
  assert(
    postToolArguments &&
      typeof postToolArguments === 'object' &&
      'allowedTools' in postToolArguments &&
      !('toolChoice' in postToolArguments),
    'Expected a previously selected tool to remain available without forcing it again after its result',
  )

  return { success: true }
}

export const testEntryNodeSeparatesStructuredContractsFromNativeToolCalls = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash'],
    toolChooser: { enabled: false },
  })
  const taskContract = {
    objective: 'Inspect the CLI documentation.',
    result: {
      mode: 'structured' as const,
      schema: {
        type: 'object' as const,
        properties: { summary: { type: 'string' as const } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  }
  const taskChain: TaskNode[] = [
    {
      id: 'task-message',
      role: 'user',
      content: { type: 'message', data: `Task objective:\n${taskContract.objective}` },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'task-message',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {
            taskContract,
            providerToolCalling: true,
            trace: { enabled: true, label: 'contract-routing' },
          },
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    {
      taskContract,
      providerToolCalling: true,
      trace: { enabled: true, label: 'contract-routing' },
    },
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-structured-tool-decision-test',
    },
  )
  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to create a structured tool-decision chain',
  )

  const continuation = result.taskChainList[0]
  const chatArguments = getFunctionCall(continuation?.[0])?.arguments
  assert(
    chatArguments &&
      typeof chatArguments === 'object' &&
      Array.isArray(chatArguments.allowedTools) &&
      chatArguments.allowedTools.length === 1 &&
      chatArguments.allowedTools[0] === 'entryNode' &&
      chatArguments.toolChoice &&
      typeof chatArguments.toolChoice === 'object' &&
      !Array.isArray(chatArguments.toolChoice) &&
      chatArguments.toolChoice.toolName === 'entryNode' &&
      !('schema' in chatArguments) &&
      !('resultMode' in chatArguments),
    'Expected a forced native entryNode call before contracted result finalization',
  )

  const selectedToolResult = await entryNodeTool.function?.(
    {},
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          taskChain[0] as TaskNode,
          taskChain[1] as TaskNode,
          {
            id: 'tool-decision-chat',
            role: 'function',
            parentID: 'entry-node',
            content: {
              type: 'functioncall',
              data: { name: 'chatCompletion', arguments: {} },
            },
          },
          {
            id: 'tool-decision-reentry',
            role: 'function',
            parentID: 'tool-decision-chat',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-selected-tool-test',
    },
  )
  assert(
    selectedToolResult &&
      typeof selectedToolResult === 'object' &&
      'taskChainList' in selectedToolResult,
    'Expected entryNode to continue with the selected native tool',
  )

  const selectedToolArguments = getFunctionCall(selectedToolResult.taskChainList[0]?.[0])?.arguments
  assert(
    selectedToolArguments &&
      typeof selectedToolArguments === 'object' &&
      'allowedTools' in selectedToolArguments &&
      Array.isArray(selectedToolArguments.allowedTools) &&
      selectedToolArguments.allowedTools[0] === 'bash' &&
      !('schema' in selectedToolArguments) &&
      'trace' in selectedToolArguments,
    'Expected the real entryNode to inherit deterministic settings from lineage without applying the contracted result schema during tool execution',
  )

  const postToolResult = await entryNodeTool.function?.(
    {},
    {
      getExecutionTaskChain: () =>
        Promise.resolve([
          ...taskChain,
          {
            id: 'tool-decision-reentry',
            role: 'function',
            content: {
              type: 'functioncall',
              data: { name: 'entryNode', arguments: { allowedTools: ['bash'] } },
            },
          },
          {
            id: 'bash-result',
            role: 'system',
            content: { type: 'toolresult', data: { stdout: 'done' } },
          },
          {
            id: 'post-tool-entry',
            role: 'function',
            content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
          },
        ]),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-structured-post-tool-test',
    },
  )
  assert(
    postToolResult && typeof postToolResult === 'object' && 'taskChainList' in postToolResult,
    'Expected entryNode to decide whether more tool work is needed after a structured task tool result',
  )
  const postToolArguments = getFunctionCall(postToolResult.taskChainList[0]?.[0])?.arguments
  const postToolPrompts =
    postToolArguments &&
    typeof postToolArguments === 'object' &&
    'appendSystemPrompts' in postToolArguments &&
    Array.isArray(postToolArguments.appendSystemPrompts)
      ? postToolArguments.appendSystemPrompts.join('\n')
      : ''
  assert(
    postToolArguments &&
      typeof postToolArguments === 'object' &&
      'trace' in postToolArguments &&
      postToolPrompts.includes('Do not select a tool merely because it is available') &&
      postToolPrompts.includes('empty allowedTools list'),
    'Expected structured post-tool selection to avoid repeated work and preserve tracing',
  )

  return { success: true }
}

export const testEntryNodeDoesNotAskClarificationDuringErrorRecovery = async () => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['bash', CLARIFICATION_TOOL_NAME],
    toolChooser: { enabled: true, useTools: true },
  })
  const taskChain: TaskNode[] = [
    {
      id: 'user',
      role: 'user',
      content: {
        type: 'message',
        data: 'Research this autonomously.',
      },
    },
    {
      id: 'failed-chat',
      role: 'function',
      priorID: 'user',
      content: {
        type: 'functioncall',
        data: {
          name: 'chatCompletion',
          arguments: {
            allowedTools: ['bash', CLARIFICATION_TOOL_NAME],
          },
        },
      },
    },
    {
      id: 'error',
      role: 'system',
      parentID: 'failed-chat',
      content: {
        type: 'error',
        data: {
          message: 'server_is_overloaded',
        },
      },
    },
    {
      id: 'entry-node',
      role: 'function',
      priorID: 'error',
      content: {
        type: 'functioncall',
        data: {
          name: 'entryNode',
          arguments: {},
        },
      },
    },
  ]

  const result = await entryNodeTool.function?.(
    {},
    {
      getExecutionTaskChain: () => Promise.resolve(taskChain),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: new AbortController().signal,
      toolId: 'entry-node-error-test',
    },
  )

  assert(
    result && typeof result === 'object' && 'taskChainList' in result,
    'Expected entryNode to return a task result',
  )

  const chatCompletionCall = getFunctionCall(result.taskChainList[0]?.[0])
  const args =
    chatCompletionCall &&
    typeof chatCompletionCall === 'object' &&
    'arguments' in chatCompletionCall &&
    chatCompletionCall.arguments &&
    typeof chatCompletionCall.arguments === 'object'
      ? chatCompletionCall.arguments
      : undefined
  const allowedTools = args && 'allowedTools' in args ? args.allowedTools : undefined

  if (!Array.isArray(allowedTools)) {
    throw new Error('Expected error recovery chatCompletion to include allowed tools')
  }
  assert(
    allowedTools.includes('bash'),
    'Expected error recovery to preserve non-clarification tools',
  )
  assert(
    !allowedTools.includes(CLARIFICATION_TOOL_NAME),
    'Expected error recovery to filter askClarifyingQuestions from allowed tools',
  )

  return { success: true }
}

export const testEntryNodeRecoversFromMalformedPythonToolCall = async (
  context?: DiagnosticsTestContext,
) => {
  if (!context?.providerKey) {
    return {
      skipped: true,
      reason: 'No configured provider key/session was available from the diagnostics harness.',
    }
  }
  const runtimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!runtimeConfig) {
    return {
      skipped: true,
      reason: 'No runtime llmSettings were provided by the diagnostics harness.',
    }
  }

  const storage = createPortableTestStorage()
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['executePythonScript'],
    toolChooser: { enabled: true, useTools: true },
  })
  const executePythonScriptTool = createTool({
    name: 'executePythonScript',
    description: 'Execute Python code in the diagnostics runtime.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    function: ({ code }) => ({
      ok: true,
      stdout: code,
    }),
  })
  const defaultToolSetup = createDefaultTaskyonToolSetup()
  const toolSetup = {
    ...defaultToolSetup,
    baseTools: defaultToolSetup.baseTools.filter(
      (tool) => tool.name !== executePythonScriptTool.name,
    ),
  }

  const ty = await tyCore(
    () => runtimeConfig.settings,
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {
      chatCompletion: runtimeConfig.providerSettings,
      entryNode: {
        providerToolCalling: true,
      },
    },
    undefined,
    {
      toolSetup,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [entryNodeTool, executePythonScriptTool],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          if (!call.taskId) throw new Error('Expected task id for entryNode test')
          return createTaskyonClient(ty.port).task.getChain({ id: call.taskId })
        },
      }),
  })

  try {
    const selectedApi = runtimeConfig.providerSettings.provider
    const providerKey = context.providerKey
    await ty.updateChatCompletionApiKey(selectedApi, providerKey)

    const observed: TaskNode[] = []
    const byId = new Map<string, TaskNode>()
    const finish = await new Promise<{ assistant: TaskNode; tasks: TaskNode[] }>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe()
          reject(new Error('Timed out waiting for entry-node recovery flow'))
        }, 180_000)
        const unsubscribe = ty.port.receive((msg) => {
          if (msg.type !== 'taskCreated' || !msg.task) return
          const task = msg.task
          observed.push(task)
          byId.set(task.id, task)
          if (task.role === 'assistant' && task.content.type === 'message') {
            const text = String(task.content.data ?? '')
            if (text.length > 0) {
              clearTimeout(timeout)
              unsubscribe()
              resolve({ assistant: task, tasks: observed })
            }
          }
        })
        void buildLinkedTaskChain([
          {
            role: 'user',
            content: {
              type: 'message',
              data: [
                'Use executePythonScript and do exactly this sequence:',
                '1) First call it with wrong parameters: {"script":"print(\\"broken\\")"} so it fails.',
                '2) Then recover and call it correctly with {"code":"print(\\"recovered-ok\\")"}.',
                '3) After successful execution, respond with a short assistant message.',
              ].join('\n'),
            },
          },
          toolCall({
            name: 'entryNode',
            arguments: {},
          }),
        ])
          .then((tasks) =>
            createTaskyonClient(ty.port).task.createChain({
              execute: true,
              show: false,
              tasks,
            }),
          )
          .catch(reject)
      },
    )

    const pythonCalls = finish.tasks.filter(
      (task) =>
        task.content.type === 'functioncall' && task.content.data.name === 'executePythonScript',
    )
    const pythonToolResults = finish.tasks.filter((task) => {
      if (task.content.type !== 'toolresult' || !task.parentID) return false
      const parent = byId.get(task.parentID)
      return (
        parent?.content.type === 'functioncall' &&
        parent.content.data.name === 'executePythonScript'
      )
    })
    const errorTasks = finish.tasks.filter((task) => task.content.type === 'error')
    const invalidArgumentsError = errorTasks.find((task) => {
      const message = humanizeError(task.content.data)
      return (
        message.includes('Invalid arguments for tool "executePythonScript"') &&
        message.includes("required property 'code'")
      )
    })
    const successfulPythonResult = pythonToolResults.find((task) => {
      const data = task.content.data as { ok?: unknown; stdout?: unknown }
      return (
        data.ok === true && typeof data.stdout === 'string' && data.stdout.includes('recovered-ok')
      )
    })

    assert(
      Boolean(invalidArgumentsError),
      'Expected malformed executePythonScript arguments to be rejected before task creation',
    )
    assert(pythonCalls.length === 1, 'Expected one corrected executePythonScript task call')
    assert(
      Boolean(successfulPythonResult),
      'Expected successful executePythonScript toolresult with "recovered-ok"',
    )

    return {
      success: true,
      model: context.model,
      selectedApi,
      assistantMessage:
        finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
      counts: {
        observedTasks: finish.tasks.length,
        pythonCalls: pythonCalls.length,
        pythonToolResults: pythonToolResults.length,
        invalidArgumentErrors: invalidArgumentsError ? 1 : 0,
      },
    }
  } finally {
    toolRpcExecutor.destroy()
    await ty.dispose('entry-node malformed Python recovery diagnostic complete')
    storage.destroy()
  }
}

testEntryNodeRecoversFromMalformedPythonToolCall.description =
  'EntryNode should recover from malformed executePythonScript parameters by retrying with corrected arguments.'
testEntryNodeRecoversFromMalformedPythonToolCall.modelBased = true
testEntryNodeRecoversFromMalformedPythonToolCall.timeoutMs = 210_000

testEntryNodeDoesNotAskClarificationDuringErrorRecovery.description =
  'EntryNode should not ask human clarification questions while recovering from a tool error.'
testEntryNodePropagatesTaskContractWithoutPromptDuplication.description =
  'EntryNode should carry task contracts through re-entry without repeating visible contract text in system prompts.'
testEntryNodeForwardsContractedResultSchema.description =
  'EntryNode should forward contracted structured result requirements to final chat completions.'
testEntryNodeHonorsExplicitAllowedToolRestrictions.description =
  'EntryNode should enforce empty and restricted allowedTools overrides against the configured tool catalog.'
