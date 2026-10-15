export default {
  formatVersion: 3,
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {
      budgetUsd: {
        default: 18000000,
        minimum: 1,
        type: 'number',
      },
      maxMassKg: {
        default: 340,
        minimum: 0,
        type: 'number',
      },
      maxPowerW: {
        default: 1000,
        minimum: 0,
        type: 'number',
      },
      minCapacity: {
        default: 240,
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
        default: 18000000,
        minimum: 1,
        type: 'number',
      },
      maxMassKg: {
        default: 340,
        minimum: 0,
        type: 'number',
      },
      maxPowerW: {
        default: 1000,
        minimum: 0,
        type: 'number',
      },
      minCapacity: {
        default: 240,
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
