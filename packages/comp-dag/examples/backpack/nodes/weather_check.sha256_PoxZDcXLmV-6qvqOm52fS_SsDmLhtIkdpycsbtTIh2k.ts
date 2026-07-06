import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:PoxZDcXLmV-6qvqOm52fS_SsDmLhtIkdpycsbtTIh2k',
  localName: 'weather_check',
  label: 'Weather Check',
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
      requirements: { weather: string }
      candidates: {
        items: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }
    }
  }) => ({
    requiredTags: inputs.requirements.weather === 'rain' ? ['rain'] : [],
    readyItems: inputs.candidates.items.filter(
      (item) => inputs.requirements.weather !== 'rain' || item.tags.includes('rain'),
    ),
  }),
} satisfies StoredDagNodeModule
