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
      mode: {
        type: 'string',
      },
    },
    required: ['mode'],
    type: 'object',
  },
  run: async () => ({
    mode: 'utility-first',
  }),
  ids: { recommendation_policy: { label: 'Recommendation Policy', inputs: {} } },
}
