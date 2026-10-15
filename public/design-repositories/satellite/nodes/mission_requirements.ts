export default {
  formatVersion: 3,
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {
      budgetUsd: {
        default: 3200000,
        minimum: 1,
        type: 'number',
      },
      maxMassKg: {
        default: 130,
        minimum: 0,
        type: 'number',
      },
      maxPowerW: {
        default: 620,
        minimum: 0,
        type: 'number',
      },
      minCapacity: {
        default: 18,
        minimum: 0,
        type: 'number',
      },
      performanceWeight: {
        default: 0.55,
        maximum: 1,
        minimum: 0,
        type: 'number',
      },
    },
    required: [],
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      budgetUsd: {
        default: 3200000,
        minimum: 1,
        type: 'number',
      },
      maxMassKg: {
        default: 130,
        minimum: 0,
        type: 'number',
      },
      maxPowerW: {
        default: 620,
        minimum: 0,
        type: 'number',
      },
      minCapacity: {
        default: 18,
        minimum: 0,
        type: 'number',
      },
      performanceWeight: {
        default: 0.55,
        maximum: 1,
        minimum: 0,
        type: 'number',
      },
    },
    required: [],
    type: 'object',
  },
  run: async ({ params }) => ({ ...params }),
  ids: { mission_requirements: { label: 'Mission Requirements', inputs: {} } },
}
