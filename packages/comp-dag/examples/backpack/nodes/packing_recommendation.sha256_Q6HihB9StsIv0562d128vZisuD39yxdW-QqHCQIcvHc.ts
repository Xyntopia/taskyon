import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:Q6HihB9StsIv0562d128vZisuD39yxdW-QqHCQIcvHc',
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
      nodeId: 'sha256:uGzoezHgY1VE3E32jXej3Myb9aLRqa-nwx0G3Wq5NrA',
      role: 'exposed',
    },
    score: {
      nodeId: 'sha256:nsP-laxeiVM-v60R4IS8_JAOl9JMWIjk1CnxXuJemqg',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:H3H8QAty_5XQovoLjxchUis4AGlYuJd7xKUkX-MvMY0',
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
