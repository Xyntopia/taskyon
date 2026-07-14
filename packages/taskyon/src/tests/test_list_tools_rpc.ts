import {
  createDuplexChannel,
  createPortClient,
  createPortServer,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { createTaskyonClient } from '../api'
import { taskyonProtocol } from '../api/taskyonProtocol'
import { useTyTaskManager } from '../core/taskManager'
import type { TaskyonMessage } from '../api/taskyonProtocol'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'
import { getDatabase } from '../utils/pglite.api'

type TestMessage = TaskyonMessage | { type: 'funnyMessage'; data: string }
type TaskyonProtocolMessage = ProtocolMessage<typeof taskyonProtocol>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

const exampleTool: ToolBase = {
  name: 'exampleTool',
  description: 'Example tool returned by the listTools RPC test.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
}

const exampleTaskChain: TaskNode[] = [
  {
    id: 'task-a',
    role: 'user',
    content: { type: 'message', data: 'first' },
  },
  {
    id: 'task-b',
    role: 'assistant',
    priorID: 'task-a',
    content: { type: 'message', data: 'second' },
  },
]

export const testTaskyonProtocolPingReportsReady = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    peer: {
      ping: ({ nonce }) => ({
        ok: true,
        protocol: 'taskyon.core',
        version: '1',
        status: 'ready',
        ...(nonce ? { nonce } : {}),
      }),
    },
  })

  try {
    const response = await createPortClient(clientPort, taskyonProtocol).peer.ping({
      nonce: 'diagnostic',
      timeoutMs: 1000,
    })
    assert(response.ok, 'Expected ping response to report ok=true')
    assert(response.protocol === 'taskyon.core', 'Expected Taskyon core protocol id')
    assert(response.version === '1', 'Expected Taskyon core protocol version')
    assert(response.status === 'ready', 'Expected Taskyon core to report ready')
    assert(response.nonce === 'diagnostic', 'Expected ping nonce to roundtrip')
  } finally {
    unsubscribe()
  }
}

testTaskyonProtocolPingReportsReady.description =
  'Reports Taskyon core protocol readiness through the ping RPC.'

export const testTaskyonClientWaitUntilReadyUsesReadyEvent = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const client = createTaskyonClient(clientPort)

  const ready = client.waitUntilReady({
    readinessTimeoutMs: 1000,
  })
  taskyonPort.send({ type: 'taskyonReady' })
  await ready
}

testTaskyonClientWaitUntilReadyUsesReadyEvent.description =
  'Resolves Taskyon client readiness from the taskyonReady lifecycle event without probing repeatedly.'

export const testTaskyonClientWaitUntilReadyFallsBackToSinglePing = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  let pingCount = 0
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    peer: {
      ping: ({ nonce }) => {
        pingCount += 1
        return {
          ok: true,
          protocol: 'taskyon.core',
          version: '1',
          status: 'ready',
          ...(nonce ? { nonce } : {}),
        }
      },
    },
  })

  try {
    await createTaskyonClient(clientPort).waitUntilReady({
      readinessTimeoutMs: 1,
    })
    assert(pingCount === 1, 'Expected readiness fallback to send exactly one ping')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientWaitUntilReadyFallsBackToSinglePing.description =
  'Falls back to one Taskyon core ping when no initial taskyonReady event is observed.'

export const testTaskyonClientAcceptsReadyEventAfterPingFallback = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const ready = createTaskyonClient(clientPort).waitUntilReady({
    readinessTimeoutMs: 1000,
  })

  await new Promise((resolve) => setTimeout(resolve, 300))
  taskyonPort.send({ type: 'taskyonReady' })
  await ready
}

testTaskyonClientAcceptsReadyEventAfterPingFallback.description =
  'Accepts a delayed taskyonReady event while readiness probes are pending.'

export const testTaskyonClientReadinessSurvivesLateTransportConnection = async () => {
  const { x: clientPort, y: clientTransportPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const { x: coreTransportPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const unsubscribeServer = createPortServer(taskyonPort, taskyonProtocol, {
    peer: {
      ping: ({ nonce }) => ({
        ok: true,
        protocol: 'taskyon.core',
        version: '1',
        status: 'ready',
        ...(nonce ? { nonce } : {}),
      }),
    },
  })

  const ready = createTaskyonClient(clientPort).waitUntilReady({
    readinessTimeoutMs: 1000,
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const disconnectTransport = clientTransportPort.connect(coreTransportPort)

  try {
    await ready
  } finally {
    disconnectTransport()
    unsubscribeServer()
  }
}

testTaskyonClientReadinessSurvivesLateTransportConnection.description =
  'Retries readiness probes when the Taskyon transport connects after the first probe was sent.'

export const testTaskyonClientDefersApiCallsUntilReadyEvent = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  let listToolsCount = 0
  const getListToolsCount = () => listToolsCount
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    tools: {
      list: () => {
        listToolsCount += 1
        return { [exampleTool.name]: exampleTool }
      },
    },
  })

  try {
    const toolsPromise = createTaskyonClient(clientPort).tools.list({ timeoutMs: 1000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert(getListToolsCount() === 0, 'Expected listTools call to wait before taskyonReady')

    taskyonPort.send({ type: 'taskyonReady' })
    const tools = await toolsPromise
    assert(tools.exampleTool?.name === exampleTool.name, 'Expected deferred listTools response')
    assert(getListToolsCount() === 1, 'Expected deferred listTools to execute once')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientDefersApiCallsUntilReadyEvent.description =
  'Defers Taskyon client protocol calls until the core taskyonReady event is observed.'

export const testTaskyonClientDefersApiCallsWithSinglePingFallback = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  let pingCount = 0
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    peer: {
      ping: ({ nonce }) => {
        pingCount += 1
        return {
          ok: true,
          protocol: 'taskyon.core',
          version: '1',
          status: 'ready',
          ...(nonce ? { nonce } : {}),
        }
      },
    },
    tools: {
      list: () => ({ [exampleTool.name]: exampleTool }),
    },
  })

  try {
    const tools = await createTaskyonClient(clientPort, {
      deferUntilReady: { readinessTimeoutMs: 1 },
    }).tools.list({ timeoutMs: 1000 })
    assert(tools.exampleTool?.name === exampleTool.name, 'Expected listTools response after ping')
    assert(pingCount === 1, 'Expected deferred API call to send exactly one readiness ping')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientDefersApiCallsWithSinglePingFallback.description =
  'Uses one readiness ping before a Taskyon client protocol call when no ready event is observed.'

export const testTaskyonClientCanDisableDeferredReadiness = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    tools: {
      list: () => ({ [exampleTool.name]: exampleTool }),
    },
  })

  try {
    const tools = await createTaskyonClient(clientPort, { deferUntilReady: false }).tools.list({
      timeoutMs: 1000,
    })
    assert(tools.exampleTool?.name === exampleTool.name, 'Expected opt-out listTools response')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientCanDisableDeferredReadiness.description =
  'Allows Taskyon client callers to opt out of deferred readiness for low-level protocol tests.'

export const testTaskyonClientGetsTaskIdChainThroughProtocol = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    task: {
      getIdChain: ({ id, maxFollow, selection }) => {
        assert(id === 'task-c', 'Expected task id to be forwarded')
        assert(maxFollow === 3, 'Expected maxFollow to be forwarded')
        assert(selection?.method === 'lineage', 'Expected chain selection to be forwarded')
        return ['task-a', 'task-b', 'task-c']
      },
    },
  })

  try {
    const ids = await createTaskyonClient(clientPort, {
      deferUntilReady: false,
    }).task.getIdChain({
      id: 'task-c',
      maxFollow: 3,
      selection: {
        method: 'lineage',
        includeSubtaskResults: 'terminal-visible',
      },
    })
    assert(ids.join(',') === 'task-a,task-b,task-c', 'Expected protocol task id chain result')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientGetsTaskIdChainThroughProtocol.description =
  'Reads selected task id chains through the Taskyon protocol client.'

export const testTaskyonClientGetsFirstLevelChildChainsThroughProtocol = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const childChains = [
    [
      {
        id: 'branch-a',
        role: 'user' as const,
        parentID: 'planner',
        content: { type: 'message' as const, data: 'Branch A' },
      },
    ],
    [
      {
        id: 'branch-b',
        role: 'user' as const,
        parentID: 'planner',
        content: { type: 'message' as const, data: 'Branch B' },
      },
    ],
  ]
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    task: {
      getChildChains: ({ id }) => {
        assert(id === 'planner', 'Expected parent task id to be forwarded')
        return childChains
      },
    },
  })

  try {
    const result = await createTaskyonClient(clientPort, {
      deferUntilReady: false,
    }).task.getChildChains({ id: 'planner' })
    assert(result.length === 2, `Expected two child chains, got ${result.length}`)
    assert(result[1]?.[0]?.id === 'branch-b', 'Expected complete first-level child chains')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientGetsFirstLevelChildChainsThroughProtocol.description =
  'Reads every first-level child chain through the Taskyon protocol, independent of the selected branch.'

export const testTaskyonClientGetsTaskChainThroughProtocol = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    task: {
      getChain: ({ id, maxFollow, selection }) => {
        assert(id === 'task-b', 'Expected task id to be forwarded')
        assert(maxFollow === 2, 'Expected maxFollow to be forwarded')
        assert(selection?.method === 'flattened', 'Expected chain selection to be forwarded')
        return exampleTaskChain
      },
    },
  })

  try {
    const tasks = await createTaskyonClient(clientPort, {
      deferUntilReady: false,
    }).task.getChain({
      id: 'task-b',
      maxFollow: 2,
      selection: {
        method: 'flattened',
        onlyFirstChild: true,
      },
    })
    assert(tasks.map((task) => task.id).join(',') === 'task-a,task-b', 'Expected task chain result')
  } finally {
    unsubscribe()
  }
}

testTaskyonClientGetsTaskChainThroughProtocol.description =
  'Reads selected task chains through the Taskyon protocol client.'

export const testTaskGetChainMissingTaskReturnsProtocolValidErrorTask = async () => {
  const taskManager = await useTyTaskManager(
    await getDatabase(`taskyon-missing-chain-${Date.now()}`),
    {
      indexTaskVectors: false,
    },
  )
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<
    TaskyonProtocolMessage,
    TaskyonProtocolMessage
  >()
  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    task: {
      getChain: async ({ id, maxFollow, selection }) =>
        await taskManager.getTaskChain(id, maxFollow, selection),
    },
  })

  try {
    const tasks = await createTaskyonClient(clientPort, {
      deferUntilReady: false,
    }).task.getChain({
      id: 'missing-task',
      timeoutMs: 1000,
    })
    const fallbackTask = tasks[0]
    assert(fallbackTask?.id === 'missing-task', 'Expected missing task fallback to preserve id')
    assert(fallbackTask.content.type === 'error', 'Expected missing task fallback to be an error')
  } finally {
    unsubscribe()
  }
}

testTaskGetChainMissingTaskReturnsProtocolValidErrorTask.description =
  'Returns schema-valid error tasks when task.getChain references an inaccessible task id.'

export const testListToolsRpcIgnoresUnrelatedResponses = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    tools: {
      list: (request) => {
        taskyonPort.send({
          type: 'tools.listResponse',
          requestId: `${request.requestId}-unrelated`,
          result: {},
        })
        return { [exampleTool.name]: exampleTool }
      },
    },
  })

  try {
    const tools = await createPortClient(clientPort, taskyonProtocol).tools.list({
      timeoutMs: 1000,
    })
    assert(tools.exampleTool?.name === exampleTool.name, 'Expected matching listTools response')
  } finally {
    unsubscribe()
  }
}

testListToolsRpcIgnoresUnrelatedResponses.description =
  'Resolves listTools only from the tools.listResponse with the matching requestId.'

export const testListToolsRpcTimesOut = async () => {
  const { x: clientPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  try {
    await createPortClient(clientPort, taskyonProtocol).tools.list({ timeoutMs: 5 })
  } catch (error) {
    assert(error instanceof Error, 'Expected timeout to reject with an Error')
    const message = error.message
    assert(message.includes('timed out'), 'Expected timeout error message')
    return
  }

  throw new Error('Expected listTools RPC to time out without a response')
}

testListToolsRpcTimesOut.description =
  'Rejects listTools when no matching tools.listResponse arrives before timeout.'

export const testPortServerReportsOnlyUnhandledCommands = async () => {
  {
    const { x: clientPort, y: taskyonPort } = createDuplexChannel<TestMessage, TestMessage>()
    const unhandled: Array<{ command: string; requestId: string }> = []
    const unknownMessages: unknown[] = []
    const unsubscribe = createPortServer(
      taskyonPort,
      taskyonProtocol,
      {},
      {
        onUnhandledCommand: ({ command, request }) => {
          unhandled.push({ command, requestId: request.requestId })
        },
        onUnknownMessage: (message) => {
          unknownMessages.push(message)
        },
      },
    )

    try {
      clientPort.send({
        type: 'taskCreated',
        task: undefined,
      })
      clientPort.send({
        type: 'tools.listResponse',
        requestId: 'not-a-request',
        result: {},
      })
      assert(unhandled.length === 0, 'Expected stream and response messages to be ignored')
      assert(unknownMessages.length === 0, 'Expected stream and response messages to be known')
      clientPort.send({
        type: 'funnyMessage',
        data: 'unexpected',
      })
      requireValue(unknownMessages.at(0), 'Expected unknown non-protocol message to be reported')
    } finally {
      unsubscribe()
    }
  }

  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const unhandled: Array<{ command: string; requestId: string }> = []
  const unsubscribe = createPortServer(
    taskyonPort,
    taskyonProtocol,
    {},
    {
      onUnhandledCommand: ({ command, request }) => {
        unhandled.push({ command, requestId: request.requestId })
      },
    },
  )

  try {
    try {
      await createPortClient(clientPort, taskyonProtocol).tools.list({ timeoutMs: 5 })
    } catch (error) {
      assert(error instanceof Error, 'Expected unhandled command request to time out')
    }

    const event = requireValue(unhandled.at(0), 'Expected an unhandled command event')
    assert(unhandled.length === 1, 'Expected exactly one unhandled command event')
    assert(event.command === 'tools.list', 'Expected tools.list unhandled command')
  } finally {
    unsubscribe()
  }
}

testPortServerReportsOnlyUnhandledCommands.description =
  'Reports parsed command requests without handlers, while ignoring non-command protocol messages.'
