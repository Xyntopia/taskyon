import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:MXpklGAvvhhZ68QSQw099lA4QmhSSfcbQ5bxLO_duZ8',
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
      nodeId: 'sha256:dDfrvNKGdZXdVEX1I1PYacBED7g-HmIZv8lo88wLlPE',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:ESU-osE9xaSNLCo6xryeGMe78enpuSvjCq1O8X4vxLs',
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
