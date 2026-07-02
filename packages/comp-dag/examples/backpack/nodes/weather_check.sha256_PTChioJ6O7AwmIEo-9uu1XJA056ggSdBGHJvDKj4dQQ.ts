export default {
  formatVersion: 2,
  id: 'sha256:PTChioJ6O7AwmIEo-9uu1XJA056ggSdBGHJvDKj4dQQ',
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
      nodeId: 'sha256:_f9_PhbjBSxk-XoTB-XyMVqlrqKIv2Zk6GcSgDJF9u8',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:EXNCCXyfBC7KT0CDpYIP__d8AjYyaRzrZ2und-l_u-s',
      role: 'internal',
    },
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
}
