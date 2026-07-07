import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:ESU-osE9xaSNLCo6xryeGMe78enpuSvjCq1O8X4vxLs',
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
      nodeId: 'sha256:FhZ8dHgrhPdpjqVA-_-7pZQ1lhcVV50xou2yPkUdctc',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:7pUkjhlI3XyXUsL-choKxiAWGguRspkjkcAsNmnG8Bo',
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
