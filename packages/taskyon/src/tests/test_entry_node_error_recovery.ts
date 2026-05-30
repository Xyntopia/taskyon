import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { tyCore } from '../core/init'
import { toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { createStandardEntryNodeTool } from '../tools/entryNode'

const resolveApiKey = () =>
  process.env.TASKYON_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim() ||
  process.env.OPENROUTER_API_KEY?.trim() ||
  ''

const resolveApiConfig = (apiKey: string, model: string) => {
  if (process.env.TASKYON_API_KEY?.trim() === apiKey) {
    return {
      selectedApi: 'taskyon',
      llmApis: {
        taskyon: {
          name: 'taskyon',
          baseURL: 'https://share.taskyon.space/chatCompletion/api/v1',
          defaultModel: model,
          selectedModel: model,
          streamSupport: true,
          routes: {
            chatCompletion: '/chat/completions',
            models: '/models',
          },
        },
      },
    }
  }
  return {
    selectedApi: 'openai',
    llmApis: {
      openai: {
        name: 'openai',
        baseURL: 'https://api.openai.com/v1',
        defaultModel: model,
        selectedModel: model,
        streamSupport: true,
        routes: {
          chatCompletion: '/chat/completions',
          models: '/models',
        },
      },
    },
  }
}

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testEntryNodeRecoversFromMalformedPythonToolCall = async () => {
  const apiKey = resolveApiKey()
  if (!apiKey) {
    return {
      skipped: true,
      reason: 'No API key found. Set TASKYON_API_KEY or OPENAI_API_KEY or OPENROUTER_API_KEY.',
    }
  }

  const model = process.env.TASKYON_TEST_MODEL?.trim() || 'gpt-4o-mini'
  const apiConfig = resolveApiConfig(apiKey, model)
  const dataDir = join(tmpdir(), `taskyon-entrynode-test-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })
  const entryNodeTool = createStandardEntryNodeTool({
    defaultAllowedTools: ['executePythonScript'],
    toolChooser: { enabled: true, useTools: true },
  })

  const ty = await tyCore(
    () => ({
      selectedApi: apiConfig.selectedApi,
      llmApis: apiConfig.llmApis,
      maxAutonomousTasks: 12,
      siteUrl: 'https://taskyon.space',
      summaryModel: 'Xenova/distilbart-cnn-6-6',
      vectorizationModel: 'Xenova/all-MiniLM-L6-v2',
      enableToolChooser: true,
      entryNode: toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    }),
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    () => ({
      chatCompletion: {
        llmTools: true,
      },
    }),
    [entryNodeTool],
    undefined,
    { nodePgLiteDataDir: dataDir },
  )

  await ty.setSecret('chatCompletionApiKeys', apiConfig.selectedApi, apiKey)
  await ty.updateChatCompletionApiKey(apiConfig.selectedApi, apiKey)

  const observed: TaskNode[] = []
  const byId = new Map<string, TaskNode>()
  const finish = await new Promise<{ assistant: TaskNode; tasks: TaskNode[] }>((resolve, reject) => {
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
    ty.port.send({
      type: 'tasks',
      execute: true,
      show: false,
      tasks: [
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
      ],
    })
  })

  const pythonCalls = finish.tasks.filter(
    (task) => task.content.type === 'functioncall' && task.content.data.name === 'executePythonScript',
  )
  const pythonToolResults = finish.tasks.filter((task) => {
    if (task.content.type !== 'toolresult' || !task.parentID) return false
    const parent = byId.get(task.parentID)
    return parent?.content.type === 'functioncall' && parent.content.data.name === 'executePythonScript'
  })
  const errorTasks = finish.tasks.filter((task) => task.content.type === 'error')
  const pythonErrorTasks = errorTasks.filter((task) => {
    const parent = task.parentID ? byId.get(task.parentID) : undefined
    return parent?.content.type === 'functioncall' && parent.content.data.name === 'executePythonScript'
  })

  const firstPythonCall = pythonCalls[0]
  const firstArgs = firstPythonCall?.content.type === 'functioncall' ? firstPythonCall.content.data.arguments : {}
  const usedWrongArgs = firstArgs && typeof firstArgs === 'object' && 'script' in firstArgs
  const successfulPythonResult = pythonToolResults.find((task) => {
    const data = task.content.data as { ok?: unknown; stdout?: unknown }
    return data?.ok === true && typeof data.stdout === 'string' && data.stdout.includes('recovered-ok')
  })

  assert(pythonCalls.length >= 2, 'Expected at least two executePythonScript calls (broken + recovered)')
  assert(Boolean(usedWrongArgs), 'Expected first executePythonScript call to use malformed "script" argument')
  assert(pythonErrorTasks.length >= 1, 'Expected at least one error task attached to executePythonScript call')
  assert(Boolean(successfulPythonResult), 'Expected successful executePythonScript toolresult with "recovered-ok"')

  return {
    success: true,
    model,
    selectedApi: apiConfig.selectedApi,
    assistantMessage: finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
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
