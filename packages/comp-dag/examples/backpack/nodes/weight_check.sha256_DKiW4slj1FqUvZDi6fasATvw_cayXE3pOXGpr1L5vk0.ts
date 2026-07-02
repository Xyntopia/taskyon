export default {
  formatVersion: 2,
  id: 'sha256:DKiW4slj1FqUvZDi6fasATvw_cayXE3pOXGpr1L5vk0',
  localName: 'weight_check',
  label: 'Weight Check',
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
    candidates: {
      nodeId: 'sha256:_f9_PhbjBSxk-XoTB-XyMVqlrqKIv2Zk6GcSgDJF9u8',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:EXNCCXyfBC7KT0CDpYIP__d8AjYyaRzrZ2und-l_u-s',
      role: 'internal',
    },
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
}
