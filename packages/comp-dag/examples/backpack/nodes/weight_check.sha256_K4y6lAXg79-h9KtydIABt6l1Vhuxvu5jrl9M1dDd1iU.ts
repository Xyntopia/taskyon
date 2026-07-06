import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:K4y6lAXg79-h9KtydIABt6l1Vhuxvu5jrl9M1dDd1iU',
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
      nodeId: 'sha256:EenXnHfn-vTjPqpPohK0skrmOp-7qdeiMT5xJd71-A4',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:t5i4w0ON5TmIuPmDwujtk1HhloybQ1UvGZIKk-JXI50',
      role: 'internal',
    },
  },
  run: async ({
    inputs,
  }: {
    inputs: {
      requirements: { maxWeightKg: number }
      candidates: {
        items: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }
    }
  }) => {
    const maxWeightKg = inputs.requirements.maxWeightKg
    const sorted = [...inputs.candidates.items].sort((a, b) => b.utility - a.utility)
    const selected = []
    let totalWeightKg = 0
    for (const item of sorted) {
      if (totalWeightKg + item.weightKg > maxWeightKg) continue
      selected.push(item)
      totalWeightKg += item.weightKg
    }
    return { selected, totalWeightKg, maxWeightKg }
  },
} satisfies StoredDagNodeModule
