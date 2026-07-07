import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:uG3mRzNB9ghKBV3kXa-p_jSKGjRNaF4ynN922x5hw6g',
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
