import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:rNDU_wD8Y3t2p9k-nPqM_rCDU69hTyvpe3Q5qnAOHB4',
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
  run: async (_ctx: { params: Record<string, unknown>; inputs: Record<string, unknown> }) => ({
    mode: 'utility-first',
  }),
} satisfies StoredDagNodeModule
