import { summarizeProtocolMessageForLog } from '../core/protocolLogging'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testProtocolLoggingSummarizesTaskChainResponses = () => {
  const message = {
    type: 'task.getChainResponse',
    requestId: 'request-1',
    result: [
      { id: 'first', content: { type: 'message', data: 'large first payload' } },
      { id: 'last', content: { type: 'message', data: 'large last payload' } },
    ],
  }

  const summary = summarizeProtocolMessageForLog(message)
  assert(summary !== message, 'Expected a summarized copy')
  assert(
    JSON.stringify(summary).includes('large first payload') === false,
    'Expected task payloads to stay out of protocol logs',
  )
  assert(
    JSON.stringify(summary).includes('"taskCount":2'),
    'Expected the task count to remain diagnostic',
  )
}

testProtocolLoggingSummarizesTaskChainResponses.description =
  'Protocol logging records task-chain identity and size without repeatedly serializing complete task payloads.'
