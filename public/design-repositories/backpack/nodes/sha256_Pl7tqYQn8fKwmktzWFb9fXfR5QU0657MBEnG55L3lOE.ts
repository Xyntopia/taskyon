export default {
  formatVersion: 2,
  id: 'sha256:Pl7tqYQn8fKwmktzWFb9fXfR5QU0657MBEnG55L3lOE',
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
      nodeId: 'sha256:c4fozV-mLLupocGOKRHhgRrMWS0_JpAwwguOieH6CWE',
      role: 'exposed',
    },
    score: {
      nodeId: 'sha256:wnOLjdjLaifhj9vdFbTWEF98YwstC8JMUKOABW8CseY',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:DKiW4slj1FqUvZDi6fasATvw_cayXE3pOXGpr1L5vk0',
      role: 'internal',
    },
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
}
