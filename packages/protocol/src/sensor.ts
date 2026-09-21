import { z } from 'zod'

import { defineFrpServiceProtocol } from './index.ts'

export const SENSOR_PROTOCOL_ID = 'taskyon.sensor' as const
export const SENSOR_PROTOCOL_VERSION = '1' as const
export const SENSOR_PROTOCOL_LIMITS_V1 = {
  maxObservationBytes: 1_024,
  maxObservationsPerSecond: 10,
  bufferedObservationsPerSubscription: 1,
} as const

export const SensorProfileV1 = z.object({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
})

export const SensorDescriptorV1 = z.object({
  sensorId: z.string().min(1).max(128),
  profile: SensorProfileV1,
  descriptorRevision: z.string().min(1).max(128),
})

export const SensorObservationV1 = z
  .object({
    sensorId: z.string().min(1).max(128),
    descriptorRevision: z.string().min(1).max(128),
    sourcePrincipal: z.string().min(1).max(256),
    sequence: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    payload: z.unknown(),
    quality: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => value.expiresAt >= value.capturedAt, {
    message: 'Sensor observations cannot expire before capture.',
    path: ['expiresAt'],
  })

export const sensorProtocolV1 = defineFrpServiceProtocol({
  service: 'sensor',
  id: SENSOR_PROTOCOL_ID,
  version: SENSOR_PROTOCOL_VERSION,
  commands: {
    describe: {
      request: z.object({ sensorId: z.string().min(1).max(128) }),
      response: SensorDescriptorV1,
      defaultTimeoutMs: 10_000,
    },
    subscribe: {
      request: z.object({ sensorId: z.string().min(1).max(128) }),
      response: z.object({
        subscriptionId: z.string().min(1).max(128),
      }),
      defaultTimeoutMs: 10_000,
    },
    unsubscribe: {
      request: z.object({ subscriptionId: z.string().min(1).max(128) }),
      defaultTimeoutMs: 10_000,
    },
  },
  streams: {
    observations: {
      observation: z.object({
        subscriptionId: z.string().min(1).max(128),
        observation: SensorObservationV1,
      }),
      closed: z.object({
        subscriptionId: z.string().min(1).max(128),
        reason: z.enum(['cancelled', 'expired', 'revoked', 'disconnected', 'error']),
      }),
    },
  },
})

export type SensorDescriptor = z.output<typeof SensorDescriptorV1>
export type SensorObservation = z.output<typeof SensorObservationV1>
