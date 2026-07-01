import {
  createDuplexChannel,
  createPortClient,
  createPortServer,
} from '@taskyon/shared/modules/frpBus'
import { taskyonProtocol } from '../api/taskyonProtocol'
import type { TaskyonMessage } from '../types/apiTypes'
import type { ToolBase } from '../types/tools'

type TestMessage = TaskyonMessage | { type: 'funnyMessage'; data: string }

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

export const testListToolsRpcIgnoresUnrelatedResponses = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  const unsubscribe = createPortServer(taskyonPort, taskyonProtocol, {
    listTools: (request) => {
      taskyonPort.send({
        type: 'listToolsResponse',
        requestId: `${request.requestId}-unrelated`,
        result: {},
      })
      return { [exampleTool.name]: exampleTool }
    },
  })

  try {
    const tools = await createPortClient(clientPort, taskyonProtocol).listTools({ timeoutMs: 1000 })
    assert(tools.exampleTool?.name === exampleTool.name, 'Expected matching listTools response')
  } finally {
    unsubscribe()
  }
}

testListToolsRpcIgnoresUnrelatedResponses.description =
  'Resolves listTools only from the listToolsResponse with the matching requestId.'

export const testListToolsRpcTimesOut = async () => {
  const { x: clientPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  try {
    await createPortClient(clientPort, taskyonProtocol).listTools({ timeoutMs: 5 })
  } catch (error) {
    assert(error instanceof Error, 'Expected timeout to reject with an Error')
    const message = error.message
    assert(message.includes('timed out'), 'Expected timeout error message')
    return
  }

  throw new Error('Expected listTools RPC to time out without a response')
}

testListToolsRpcTimesOut.description =
  'Rejects listTools when no matching listToolsResponse arrives before timeout.'

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
        type: 'listToolsResponse',
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
      await createPortClient(clientPort, taskyonProtocol).listTools({ timeoutMs: 5 })
    } catch (error) {
      assert(error instanceof Error, 'Expected unhandled command request to time out')
    }

    const event = requireValue(unhandled.at(0), 'Expected an unhandled command event')
    assert(unhandled.length === 1, 'Expected exactly one unhandled command event')
    assert(event.command === 'listTools', 'Expected listTools unhandled command')
  } finally {
    unsubscribe()
  }
}

testPortServerReportsOnlyUnhandledCommands.description =
  'Reports parsed command requests without handlers, while ignoring non-command protocol messages.'
