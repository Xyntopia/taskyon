import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:uGzoezHgY1VE3E32jXej3Myb9aLRqa-nwx0G3Wq5NrA',
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
  run: () => ({
    mode: 'utility-first',
  }),
} satisfies StoredDagNodeModule
