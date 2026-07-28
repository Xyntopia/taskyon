import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createLoggingClient,
  createLoggingProtocolServer,
  taskyonLoggingProtocol,
  type TaskyonLogEntry,
} from '../api/loggingProtocol'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testLoggingProtocolRoutesStructuredEntriesToConfiguredSink = async () => {
  const port = createProtocolPort(taskyonLoggingProtocol)
  const received: TaskyonLogEntry[] = []
  const stop = createLoggingProtocolServer(port.y, {
    write: (entry) => {
      received.push(entry)
    },
    flush: () => undefined,
  })
  const client = createLoggingClient(port.x)

  try {
    await client.write({
      timestamp: '2026-07-28T12:00:00.000Z',
      level: 'error',
      source: 'tycli',
      message: 'download failed',
      streamId: 'session-1',
      attributes: { status: 503 },
    })
    await client.flush({})

    assert(received.length === 1, 'Expected the configured sink to receive one entry')
    assert(received[0]?.message === 'download failed', 'Expected the log message to roundtrip')
    assert(received[0]?.attributes?.status === 503, 'Expected structured attributes to roundtrip')
  } finally {
    stop()
  }
}

testLoggingProtocolRoutesStructuredEntriesToConfiguredSink.description =
  'Routes structured application logs through a sink-neutral protocol without changing task streams.'
