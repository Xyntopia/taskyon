import {
  createDuplexChannel,
  createPortRpcClient,
  registerPortRpcHandler,
} from '@taskyon/shared/modules/frpBus'
import { taskyonProtocol } from '../api/taskyonProtocol'
import type { TaskyonMessage } from '../types/apiTypes'
import type { ToolBase } from '../types/tools'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

  const unsubscribe = registerPortRpcHandler(
    taskyonPort,
    taskyonProtocol.rpc.listTools,
    (request) => {
      taskyonPort.send({
        type: 'listToolsResponse',
        requestId: `${request.requestId}-unrelated`,
        result: {},
      })
      return { [exampleTool.name]: exampleTool }
    },
  )

  try {
    const tools = await createPortRpcClient(
      clientPort,
      taskyonProtocol.rpc.listTools,
    )({ timeoutMs: 1000 })
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
    await createPortRpcClient(clientPort, taskyonProtocol.rpc.listTools)({ timeoutMs: 5 })
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
