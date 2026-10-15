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
      requirements: (params: {}) => Promise<{ weather: string }>
      candidates: (params: {}) => Promise<{
        items: Array<{ name: string; weightKg: number; utility: number; tags: string[] }>
      }>
    }
  }) => {
    const [requirements, candidates] = await Promise.all([use.requirements({}), use.candidates({})])
    return {
      requiredTags: requirements.weather === 'rain' ? ['rain'] : [],
      readyItems: candidates.items.filter(
        (item) => requirements.weather !== 'rain' || item.tags.includes('rain'),
      ),
    }
  },
  ids: {
    weather_check: {
      label: 'Weather Check',
      inputs: {
        candidates: { source: 'item_candidates', role: 'internal' },
        requirements: { source: 'trip_requirements', role: 'internal' },
      },
    },
  },
}
