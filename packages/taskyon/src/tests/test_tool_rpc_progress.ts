import { createDuplexChannel } from '@taskyon/common/modules/frpBus'
import type { TaskyonMessage } from '../api/taskyonProtocol'
import {
  callToolOverRpc,
  createExternalToolContext,
  registerToolRpcBroker,
  registerToolRpcExecutor,
  registerToolRpcTools,
} from '../core/toolRpc'
import type { ToolRpcCallMessage, ToolRpcResponderMessage } from '../core/toolRpc'
import { createTool, type ToolProgress } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testRemoteFunctionBridgeStreamsCorrelatedProgress = async () => {
  const { x: workerPort, y: remotePort } = createDuplexChannel<
    ToolRpcCallMessage,
    ToolRpcResponderMessage
  >()
  const progress: ToolProgress[] = []
  const unsubscribe = remotePort.receive((message) => {
    if (message.type !== 'functionCall') return
    remotePort.send({
      type: 'functionProgress',
      functionName: message.functionName,
      requestId: message.requestId,
      taskId: message.taskId,
      progress: {
        kind: 'status',
        message: 'inspected 5 issues',
        completed: 5,
        total: 10,
        checkpoint: true,
      },
    })
    remotePort.send({
      type: 'functionResponse',
      functionName: message.functionName,
      requestId: message.requestId,
      response: { ok: true },
    })
  })

  try {
    await callToolOverRpc({ name: 'progressTool', arguments: {} }, workerPort, {
      taskId: 'task-123',
      onProgress: (event) => {
        progress.push(event)
      },
    })
  } finally {
    unsubscribe()
  }

  assert(progress.length === 1, `Expected one progress event, got ${progress.length}`)
  const event = progress[0]
  assert(
    event?.message === 'inspected 5 issues',
    `Expected progress message, got ${JSON.stringify(event)}`,
  )
  assert(event?.checkpoint === true, 'Expected checkpoint metadata')
}

testRemoteFunctionBridgeStreamsCorrelatedProgress.description =
  'Streams progress for the matching remote tool request without completing the request early.'

export const testRemoteToolContextReportsCorrelatedProgress = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const progressTool = createTool({
    name: 'remoteProgress',
    description: 'Report progress before returning.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: async (_args, ctx) => {
      if (!ctx.reportProgress) throw new Error('Expected reportProgress in remote context')
      await ctx.reportProgress({ kind: 'stdout', message: 'first output' })
      return { ok: true }
    },
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({ port: clientPort, tools: [progressTool] })
  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'tools.registerRequest') {
    throw new Error('expected tools.registerRequest message')
  }
  taskyonPort.send({
    type: 'tools.registerResponse',
    requestId: toolDescription.requestId,
  })
  const registration = await registrationPromise
  const messages: TaskyonMessage[] = []
  const responsePromise = new Promise<void>((resolve) => {
    const unsubscribe = taskyonPort.receive((message) => {
      messages.push(message)
      if (message.type !== 'functionResponse') return
      unsubscribe()
      resolve()
    })
  })

  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteProgress',
    requestId: 'remote-progress-1',
    taskId: 'task-456',
    arguments: {},
  })
  await responsePromise
  registration.destroy()

  const progress = messages.find((message) => message.type === 'functionProgress')
  assert(progress?.type === 'functionProgress', 'Expected functionProgress before response')
  if (progress?.type !== 'functionProgress') return
  assert(progress.requestId === 'remote-progress-1', 'Expected matching request id')
  assert(progress.taskId === 'task-456', 'Expected matching task id')
  assert(progress.progress.message === 'first output', 'Expected tool progress payload')
  assert(
    messages.findIndex((message) => message.type === 'functionProgress') <
      messages.findIndex((message) => message.type === 'functionResponse'),
    'Expected progress before the final response',
  )
}

testRemoteToolContextReportsCorrelatedProgress.description =
  'Exposes reportProgress to remote tools and preserves request and task correlation.'

export const testRemoteFunctionBrokerForwardsCorrelatedProgress = async () => {
  const workerChannel = createDuplexChannel<ToolRpcCallMessage, ToolRpcResponderMessage>()
  const toolChannel = createDuplexChannel<ToolRpcCallMessage, ToolRpcResponderMessage>()
  const progressTool = createTool({
    name: 'brokeredProgress',
    description: 'Report progress through the RPC broker.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    function: async (_args, ctx) => {
      if (!ctx.reportProgress) throw new Error('Expected reportProgress in brokered context')
      await ctx.reportProgress({ message: 'brokered output', kind: 'status' })
      return 'done'
    },
  })
  const executor = registerToolRpcExecutor({
    port: toolChannel.y,
    getTool: (name) => (name === progressTool.name ? progressTool : undefined),
    createContext: (_call, signal) => createExternalToolContext(signal),
  })
  const broker = registerToolRpcBroker({
    workerPort: workerChannel.y,
    toolPort: toolChannel.x,
    prepareFunctionCall: (call) => ({
      name: call.functionName,
      arguments: call.arguments ?? {},
    }),
  })
  const progress: string[] = []

  try {
    const result = await callToolOverRpc(
      { name: 'brokeredProgress', arguments: {} },
      workerChannel.x,
      {
        taskId: 'brokered-task',
        onProgress: (event) => {
          progress.push(event.message)
        },
      },
    )
    assert(result === 'done', `Expected brokered result, got ${JSON.stringify(result)}`)
    assert(
      progress.join(',') === 'brokered output',
      `Expected brokered progress, got ${JSON.stringify(progress)}`,
    )
  } finally {
    broker.destroy()
    executor.destroy()
  }
}

testRemoteFunctionBrokerForwardsCorrelatedProgress.description =
  'Forwards progress through the worker broker while preserving the outer request correlation.'
