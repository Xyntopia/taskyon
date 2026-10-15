export default {
  formatVersion: 3,
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
  run: async () => ({
    days: 2,
    weather: 'rain',
    maxWeightKg: 7,
  }),
  ids: { trip_requirements: { label: 'Trip Requirements', inputs: {} } },
}
