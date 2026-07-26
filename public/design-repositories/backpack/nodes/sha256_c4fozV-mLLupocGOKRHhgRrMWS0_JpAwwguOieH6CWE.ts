export default {
  formatVersion: 2,
  id: 'sha256:c4fozV-mLLupocGOKRHhgRrMWS0_JpAwwguOieH6CWE',
  localName: 'recommendation_policy',
  label: 'Recommendation Policy',
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
  inputs: {},
  run: async () => ({
    mode: 'utility-first',
  }),
}
