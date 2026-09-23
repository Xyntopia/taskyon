import assert from 'node:assert/strict'
import test from 'node:test'

import { createDuplexChannel, createPortClient, createPortServer, createStream } from './index.ts'
import { sensorProtocolV1 } from './sensor.ts'

void test('streams values and disposes individual subscriptions', () => {
  const bus = createStream<number>()
  const received: number[] = []
  const unsubscribe = bus.stream((value) => {
    received.push(value)
  })

  bus.emit(1)
  unsubscribe()
  bus.emit(2)

  assert.deepEqual(received, [1])
})

void test('serves the sensor protocol through the public protocol machinery', async () => {
  const channel = createDuplexChannel<
    ReturnType<typeof sensorProtocolV1.message.parse>,
    ReturnType<typeof sensorProtocolV1.message.parse>
  >()
  const stop = createPortServer(channel.y, sensorProtocolV1, {
    sensor: {
      describe: ({ sensorId }) =>
        Promise.resolve({
          sensorId,
          profile: { id: 'dev.constellation.location', version: '1' },
          descriptorRevision: 'location-v1',
        }),
      subscribe: ({ sensorId }) => Promise.resolve({ subscriptionId: `subscription:${sensorId}` }),
      unsubscribe: () => Promise.resolve(),
    },
  })
  const client = createPortClient(channel.x, sensorProtocolV1)

  assert.deepEqual(await client.sensor.describe({ sensorId: 'phone' }), {
    sensorId: 'phone',
    profile: { id: 'dev.constellation.location', version: '1' },
    descriptorRevision: 'location-v1',
  })
  assert.deepEqual(await client.sensor.subscribe({ sensorId: 'phone' }), {
    subscriptionId: 'subscription:phone',
  })

  stop()
})
