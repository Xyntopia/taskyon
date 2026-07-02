export default {
  formatVersion: 2,
  id: 'sha256:wnOLjdjLaifhj9vdFbTWEF98YwstC8JMUKOABW8CseY',
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
      nodeId: 'sha256:PTChioJ6O7AwmIEo-9uu1XJA056ggSdBGHJvDKj4dQQ',
      role: 'internal',
    },
    weightCheck: {
      nodeId: 'sha256:DKiW4slj1FqUvZDi6fasATvw_cayXE3pOXGpr1L5vk0',
      role: 'internal',
    },
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
}
