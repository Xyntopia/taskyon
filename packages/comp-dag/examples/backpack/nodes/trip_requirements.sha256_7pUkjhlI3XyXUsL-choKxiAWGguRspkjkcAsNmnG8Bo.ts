import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:7pUkjhlI3XyXUsL-choKxiAWGguRspkjkcAsNmnG8Bo',
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
  run: () => ({
    days: 2,
    weather: 'rain',
    maxWeightKg: 7,
  }),
} satisfies StoredDagNodeModule
