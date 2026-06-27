import { createDuplexChannel } from '@taskyon/shared/modules/frpBus'
import { callToolOverRpc } from '../core/toolRpc'
import type {
  RemoteFunctionCall,
  RemoteFunctionCancel,
  RemoteFunctionResponse,
} from '../types/messages'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testRemoteFunctionBridgeHonorsToolTimeoutMs = async () => {
  const { x: workerPort, y: remotePort } = createDuplexChannel<
    RemoteFunctionCall | RemoteFunctionCancel,
    RemoteFunctionResponse
  >()
  const unsubscribe = remotePort.receive((msg) => {
    if (msg.type !== 'functionCall') return
    setTimeout(() => {
      remotePort.send({
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        response: { ok: true },
      })
    }, 30_100)
  })

  try {
    const result = await callToolOverRpc(
      {
        name: 'slowRemote',
        arguments: { timeoutMs: 31_000 },
      },
      workerPort,
    )

    assert(
      typeof result === 'object' && result !== null && 'ok' in result && result.ok === true,
      'Expected remote function response after caller-provided timeoutMs',
    )
  } finally {
    unsubscribe()
  }

  return { success: true }
}

testRemoteFunctionBridgeHonorsToolTimeoutMs.description =
  'Honors a remote tool call timeoutMs value instead of timing out all remote bridge calls after 30 seconds.'
testRemoteFunctionBridgeHonorsToolTimeoutMs.timeoutMs = 35_000
