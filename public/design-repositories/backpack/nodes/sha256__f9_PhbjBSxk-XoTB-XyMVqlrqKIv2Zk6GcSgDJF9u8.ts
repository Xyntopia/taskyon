export default {
  formatVersion: 2,
  id: 'sha256:_f9_PhbjBSxk-XoTB-XyMVqlrqKIv2Zk6GcSgDJF9u8',
  localName: 'item_candidates',
  label: 'Item Candidates',
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
  inputs: {},
  run: async () => ({
    items: [
      { name: 'tent', weightKg: 2.2, utility: 9, tags: ['sleep'] },
      { name: 'sleeping bag', weightKg: 1.4, utility: 8, tags: ['sleep'] },
      { name: 'rain jacket', weightKg: 0.4, utility: 7, tags: ['rain'] },
      { name: 'water bottle', weightKg: 1.0, utility: 8, tags: ['water'] },
      { name: 'stove', weightKg: 0.6, utility: 5, tags: ['food'] },
      { name: 'medkit', weightKg: 0.3, utility: 6, tags: ['safety'] },
      { name: 'snacks', weightKg: 0.8, utility: 4, tags: ['food'] },
      { name: 'camera', weightKg: 0.7, utility: 3, tags: ['fun'] },
    ],
  }),
}
