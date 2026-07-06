import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { DiagnosticsTestContext } from '../../../shared/modules/diagnosticsRunner'
import { tyCore } from '../core/init'
import { registerToolRpcTools } from '../core/toolRpc'
import { createTaskyonClient } from '../api'
import { createSubtasksResult, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import { CLARIFICATION_TOOL_NAME } from '../tools/clarificationTool'
import { buildLinkedTaskChain } from '../testSupport/onlineProviderSupport'
import { llmSettings } from '../types/profiles'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const getFunctionCall = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? content.data : undefined
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
      getExecutionTaskChain: async () => taskChain,
      createSubtasksResult,
      getSecret: async () => null,
      setSecret: async () => undefined,
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

  assert(
    Array.isArray(allowedTools),
    'Expected error recovery chatCompletion to include allowed tools',
  )
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
  const parsedLlmSettings = llmSettings.safeParse(context.llmSettings)
  if (!parsedLlmSettings.success) {
    return {
      skipped: true,
      reason: 'No runtime llmSettings were provided by the diagnostics harness.',
    }
  }

  const llmState = parsedLlmSettings.data
  const dataDir = join(tmpdir(), `taskyon-entrynode-test-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: ['executePythonScript'],
    toolChooser: { enabled: true, useTools: true },
  })

  const ty = await tyCore(
    () => llmState,
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    () => ({
      entryNode: {
        providerToolCalling: true,
      },
    }),
    undefined,
    { nodePgLiteDataDir: dataDir },
  )
  const toolRpcExecutor = await registerToolRpcTools({ port: ty.port, tools: [entryNodeTool] })

  const selectedApi = llmState.selectedApi ?? 'taskyon'
  const providerKey = context.providerKey
  await ty.setSecret('chatCompletionApiKeys', selectedApi, providerKey)
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
              '2) Then recover from the error and call it correctly with {"code":"print(\\"recovered-ok\\")"}.',
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
          createTaskyonClient(ty.port).createTaskChain({
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
      parent?.content.type === 'functioncall' && parent.content.data.name === 'executePythonScript'
    )
  })
  const errorTasks = finish.tasks.filter((task) => task.content.type === 'error')
  const pythonErrorTasks = errorTasks.filter((task) => {
    const parent = task.parentID ? byId.get(task.parentID) : undefined
    return (
      parent?.content.type === 'functioncall' && parent.content.data.name === 'executePythonScript'
    )
  })

  const firstPythonCall = pythonCalls[0]
  const firstArgs =
    firstPythonCall?.content.type === 'functioncall' ? firstPythonCall.content.data.arguments : {}
  const usedWrongArgs = firstArgs && typeof firstArgs === 'object' && 'script' in firstArgs
  const successfulPythonResult = pythonToolResults.find((task) => {
    const data = task.content.data as { ok?: unknown; stdout?: unknown }
    return (
      data?.ok === true && typeof data.stdout === 'string' && data.stdout.includes('recovered-ok')
    )
  })

  assert(
    pythonCalls.length >= 2,
    'Expected at least two executePythonScript calls (broken + recovered)',
  )
  assert(
    Boolean(usedWrongArgs),
    'Expected first executePythonScript call to use malformed "script" argument',
  )
  assert(
    pythonErrorTasks.length >= 1,
    'Expected at least one error task attached to executePythonScript call',
  )
  assert(
    Boolean(successfulPythonResult),
    'Expected successful executePythonScript toolresult with "recovered-ok"',
  )

  toolRpcExecutor.destroy()

  return {
    success: true,
    model: context.model,
    selectedApi: llmState.selectedApi,
    assistantMessage:
      finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
    counts: {
      observedTasks: finish.tasks.length,
      pythonCalls: pythonCalls.length,
      pythonToolResults: pythonToolResults.length,
      pythonErrorTasks: pythonErrorTasks.length,
    },
  }
}

testEntryNodeRecoversFromMalformedPythonToolCall.description =
  'EntryNode should recover from malformed executePythonScript parameters by retrying with corrected arguments.'
testEntryNodeRecoversFromMalformedPythonToolCall.timeoutMs = 210_000

testEntryNodeDoesNotAskClarificationDuringErrorRecovery.description =
  'EntryNode should not ask human clarification questions while recovering from a tool error.'
