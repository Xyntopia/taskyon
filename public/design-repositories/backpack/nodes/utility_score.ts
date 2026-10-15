export default {
  formatVersion: 3,
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
  run: async ({
    use,
  }: {
    use: {
      weightCheck: (params: {}) => Promise<{
        selected: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }>
      weatherCheck: (params: {}) => Promise<{ readyItems: Array<{ name: string }> }>
    }
  }) => {
    const [weightCheck, weatherCheck] = await Promise.all([
      use.weightCheck({}),
      use.weatherCheck({}),
    ])
    const weatherReadyNames = new Set(weatherCheck.readyItems.map((item) => item.name))
    const selected = weightCheck.selected.map((item) => ({
      ...item,
      weatherReady: weatherReadyNames.has(item.name),
    }))
    return {
      selected,
      score: selected.reduce((sum, item) => sum + item.utility + (item.weatherReady ? 2 : 0), 0),
    }
  },
  ids: {
    utility_score: {
      label: 'Utility Score',
      inputs: {
        weatherCheck: { source: 'weather_check', role: 'internal' },
        weightCheck: { source: 'weight_check', role: 'internal' },
      },
    },
  },
}
