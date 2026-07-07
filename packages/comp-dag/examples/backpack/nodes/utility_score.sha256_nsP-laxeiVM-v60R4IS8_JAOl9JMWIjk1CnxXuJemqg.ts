import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:nsP-laxeiVM-v60R4IS8_JAOl9JMWIjk1CnxXuJemqg',
  localName: 'utility_score',
  label: 'Utility Score',
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
    weatherCheck: {
      nodeId: 'sha256:hlWLFmYGkB7CZhIbjaWyeW8wctpCAURZPcxt5pK6iKo',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:H3H8QAty_5XQovoLjxchUis4AGlYuJd7xKUkX-MvMY0',
      role: 'internal',
    },
  },
  run: ({
    inputs,
  }: {
    inputs: {
      weightCheck: {
        selected: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }
      weatherCheck: { readyItems: Array<{ name: string }> }
    }
  }) => {
    const weatherReadyNames = new Set(inputs.weatherCheck.readyItems.map((item) => item.name))
    const selected = inputs.weightCheck.selected.map((item) => ({
      ...item,
      weatherReady: weatherReadyNames.has(item.name),
    }))
    return {
      selected,
      score: selected.reduce((sum, item) => sum + item.utility + (item.weatherReady ? 2 : 0), 0),
    }
  },
} satisfies StoredDagNodeModule
