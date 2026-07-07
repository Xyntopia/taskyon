import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:dDfrvNKGdZXdVEX1I1PYacBED7g-HmIZv8lo88wLlPE',
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
