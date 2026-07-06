import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:H58TdrdMud9H2Xzn-TwD2-vPkWM61Omu9npJwgst1Gc',
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
      nodeId: 'sha256:PoxZDcXLmV-6qvqOm52fS_SsDmLhtIkdpycsbtTIh2k',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:K4y6lAXg79-h9KtydIABt6l1Vhuxvu5jrl9M1dDd1iU',
      role: 'internal',
    },
  },
  run: async ({
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
