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
      requirements: (params: {}) => Promise<{ maxWeightKg: number }>
      candidates: (params: {}) => Promise<{
        items: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }>
    }
  }) => {
    const [requirements, candidates] = await Promise.all([use.requirements({}), use.candidates({})])
    const maxWeightKg = requirements.maxWeightKg
    const sorted = [...candidates.items].sort((a, b) => b.utility - a.utility)
    const selected = []
    let totalWeightKg = 0
    for (const item of sorted) {
      if (totalWeightKg + item.weightKg > maxWeightKg) continue
      selected.push(item)
      totalWeightKg += item.weightKg
    }
    return { selected, totalWeightKg, maxWeightKg }
  },
  ids: {
    weight_check: {
      label: 'Weight Check',
      inputs: {
        candidates: { source: 'item_candidates', role: 'internal' },
        requirements: { source: 'trip_requirements', role: 'internal' },
      },
    },
  },
}
