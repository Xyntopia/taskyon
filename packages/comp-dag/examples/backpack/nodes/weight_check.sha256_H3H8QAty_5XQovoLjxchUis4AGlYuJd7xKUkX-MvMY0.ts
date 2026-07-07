import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:H3H8QAty_5XQovoLjxchUis4AGlYuJd7xKUkX-MvMY0',
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
      nodeId: 'sha256:OxMDJ0HLWrB2kEUTbAQ7mLYhdHnfn2d34oAQOL02C-E',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:h_63zAb0lyL9HzAIgY6QLzv_Qg0qjiQHBGx9x8O0ckY',
      role: 'internal',
    },
  },
  run: ({
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
