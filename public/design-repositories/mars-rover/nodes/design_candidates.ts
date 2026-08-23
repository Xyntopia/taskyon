export default {
  formatVersion: 2,
  id: 'sha256:619UnvxOaz4ZAMq66ylCyqu4D_8s4gaC4UwvwSivkKQ',
  localName: 'design_candidates',
  label: 'Design Candidates',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: true,
    properties: {
      candidates: {
        items: {
          additionalProperties: true,
          properties: {
            capacity: {
              type: 'number',
            },
            costUsd: {
              type: 'number',
            },
            id: {
              type: 'string',
            },
            massKg: {
              type: 'number',
            },
            name: {
              type: 'string',
            },
            performance: {
              type: 'number',
            },
            powerW: {
              type: 'number',
            },
            reliability: {
              type: 'number',
            },
            score: {
              type: 'number',
            },
            viable: {
              type: 'boolean',
            },
          },
          required: [
            'id',
            'name',
            'costUsd',
            'capacity',
            'massKg',
            'powerW',
            'performance',
            'reliability',
          ],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['candidates'],
    type: 'object',
  },
  inputs: {},
  run: async () => ({
    candidates: [
      {
        id: 'ares-rtg',
        name: 'Ares RTG Explorer',
        costUsd: 16800000,
        capacity: 720,
        massKg: 315,
        powerW: 780,
        performance: 96,
        reliability: 94,
      },
      {
        id: 'helios-solar',
        name: 'Helios Solar Rover',
        costUsd: 9600000,
        capacity: 360,
        massKg: 218,
        powerW: 620,
        performance: 84,
        reliability: 82,
      },
      {
        id: 'pathfinder-light',
        name: 'Pathfinder Light',
        costUsd: 5400000,
        capacity: 180,
        massKg: 128,
        powerW: 410,
        performance: 76,
        reliability: 88,
      },
      {
        id: 'polar-heavy',
        name: 'Polar Heavy Laboratory',
        costUsd: 24000000,
        capacity: 900,
        massKg: 470,
        powerW: 1180,
        performance: 99,
        reliability: 91,
      },
    ],
  }),
}
