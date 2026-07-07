import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:RBAFU5zQL5WFnXjmYuCwzKFOsdIFOnFjrLGPfpMKxvg',
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
      nodeId: 'sha256:uG3mRzNB9ghKBV3kXa-p_jSKGjRNaF4ynN922x5hw6g',
      role: 'exposed',
    },
    score: {
      nodeId: 'sha256:MXpklGAvvhhZ68QSQw099lA4QmhSSfcbQ5bxLO_duZ8',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:ESU-osE9xaSNLCo6xryeGMe78enpuSvjCq1O8X4vxLs',
      role: 'internal',
    },
  },
  run: ({
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
