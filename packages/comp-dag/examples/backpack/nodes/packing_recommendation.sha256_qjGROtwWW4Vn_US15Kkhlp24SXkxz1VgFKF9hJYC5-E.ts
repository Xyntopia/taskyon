import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:qjGROtwWW4Vn_US15Kkhlp24SXkxz1VgFKF9hJYC5-E',
  localName: 'packing_recommendation',
  label: 'Packing Recommendation',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: true,
    properties: {},
    required: [],
    type: 'object',
  },
  inputs: {
    policy: {
      nodeId: 'sha256:rNDU_wD8Y3t2p9k-nPqM_rCDU69hTyvpe3Q5qnAOHB4',
      role: 'exposed',
    },
    score: {
      nodeId: 'sha256:H58TdrdMud9H2Xzn-TwD2-vPkWM61Omu9npJwgst1Gc',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:K4y6lAXg79-h9KtydIABt6l1Vhuxvu5jrl9M1dDd1iU',
      role: 'internal',
    },
  },
  run: async ({
    inputs,
  }: {
    inputs: {
      policy: { mode: string }
      score: { selected: Array<{ name: string }>; score: number }
      weightCheck: { totalWeightKg: number; maxWeightKg: number }
    }
  }) => ({
    mode: inputs.policy.mode,
    itemNames: inputs.score.selected.map((item) => item.name),
    totalWeightKg: inputs.weightCheck.totalWeightKg,
    maxWeightKg: inputs.weightCheck.maxWeightKg,
    score: inputs.score.score,
  }),
} satisfies StoredDagNodeModule
