export default {
  formatVersion: 2,
  id: 'sha256:SbqiYLA6nmSqnXC29hETtfhAS6DOf1W7ICeQlUcZemk',
  localName: 'mission_requirements',
  label: 'Mission Requirements',
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
  inputs: {},
  run: async ({ params }) => ({ ...params }),
}
