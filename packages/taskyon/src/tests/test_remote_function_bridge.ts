import { createDuplexChannel } from '@taskyon/shared/modules/frpBus'
import { handleFunctionExecution } from '../core/tools'
import type { RemoteFunctionCall, RemoteFunctionResponse } from '../types/messages'
import { createSubtasksResult, type InternalTool, type toolContext } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testRemoteFunctionBridgeHonorsToolTimeoutMs = async () => {
  const { x: workerPort, y: remotePort } = createDuplexChannel<
    RemoteFunctionCall,
    RemoteFunctionResponse
  >()
  const unsubscribe = remotePort.receive((msg) => {
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
    const result = await handleFunctionExecution(
      {
        name: 'slowRemote',
        arguments: { timeoutMs: 31_000 },
      },
      {
        name: 'slowRemote',
        description: 'Remote test tool.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            timeoutMs: { type: 'integer' },
          },
        },
      } satisfies InternalTool,
      new AbortController().signal,
      {
        taskChain: [],
        createSubtasksResult,
        getSecret: () => Promise.resolve(null),
        setSecret: () => Promise.resolve(),
        stopSignal: new AbortController().signal,
        toolId: 'test-remote-timeout',
      } satisfies toolContext,
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
