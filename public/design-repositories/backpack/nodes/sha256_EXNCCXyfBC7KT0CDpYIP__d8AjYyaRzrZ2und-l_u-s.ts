export default {
  formatVersion: 2,
  id: 'sha256:EXNCCXyfBC7KT0CDpYIP__d8AjYyaRzrZ2und-l_u-s',
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
  run: async () => ({
    days: 2,
    weather: 'rain',
    maxWeightKg: 7,
  }),
}
