export default {
  formatVersion: 3,
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
  run: async ({
    use,
  }: {
    use: {
      policy: () => Promise<{ mode: string }>
      score: (params: {}) => Promise<{ selected: Array<{ name: string }>; score: number }>
      weightCheck: (params: {}) => Promise<{ totalWeightKg: number; maxWeightKg: number }>
    }
  }) => {
    const [policy, score, weightCheck] = await Promise.all([
      use.policy(),
      use.score({}),
      use.weightCheck({}),
    ])
    return {
      mode: policy.mode,
      itemNames: score.selected.map((item) => item.name),
      totalWeightKg: weightCheck.totalWeightKg,
      maxWeightKg: weightCheck.maxWeightKg,
      score: score.score,
    }
  },
  ids: {
    packing_recommendation: {
      inputs: {
        policy: { source: 'recommendation_policy', role: 'exposed' },
        score: { source: 'utility_score', role: 'internal' },
        weightCheck: { source: 'weight_check', role: 'internal' },
      },
      label: 'Packing Recommendation',
    },
    main: {
      inputs: {
        policy: { source: 'recommendation_policy', role: 'exposed' },
        score: { source: 'utility_score', role: 'internal' },
        weightCheck: { source: 'weight_check', role: 'internal' },
      },
      label: 'Packing Recommendation',
    },
  },
}
