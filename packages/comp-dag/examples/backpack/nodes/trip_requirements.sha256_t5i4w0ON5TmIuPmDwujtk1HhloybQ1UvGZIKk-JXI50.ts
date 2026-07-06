import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:t5i4w0ON5TmIuPmDwujtk1HhloybQ1UvGZIKk-JXI50',
  localName: 'trip_requirements',
  label: 'Trip Requirements',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      days: {
        type: 'number',
      },
      maxWeightKg: {
        type: 'number',
      },
      weather: {
        type: 'string',
      },
    },
    required: ['days', 'weather', 'maxWeightKg'],
    type: 'object',
  },
  inputs: {},
  run: async (_ctx: { params: Record<string, unknown>; inputs: Record<string, unknown> }) => ({
    days: 2,
    weather: 'rain',
    maxWeightKg: 7,
  }),
} satisfies StoredDagNodeModule
