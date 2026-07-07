import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:hlWLFmYGkB7CZhIbjaWyeW8wctpCAURZPcxt5pK6iKo',
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
