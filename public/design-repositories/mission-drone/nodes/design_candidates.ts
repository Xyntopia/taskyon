export default {
  formatVersion: 2,
  id: 'sha256:q1N7z14ANQvm9YdNBggW_yQc7uTH2PHZ2h7EqvLHw18',
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
        id: 'survey-vtol',
        name: 'Surveyor VTOL',
        costUsd: 7800,
        capacity: 85,
        massKg: 13.8,
        powerW: 2450,
        performance: 92,
        reliability: 91,
      },
      {
        id: 'cargo-hex',
        name: 'Cargo Hexacopter',
        costUsd: 8400,
        capacity: 48,
        massKg: 16.2,
        powerW: 2950,
        performance: 88,
        reliability: 94,
      },
      {
        id: 'scout-quad',
        name: 'Scout Quadcopter',
        costUsd: 3900,
        capacity: 42,
        massKg: 7.4,
        powerW: 1700,
        performance: 79,
        reliability: 87,
      },
      {
        id: 'endurance-wing',
        name: 'Endurance Fixed Wing',
        costUsd: 11200,
        capacity: 140,
        massKg: 11.5,
        powerW: 1350,
        performance: 96,
        reliability: 89,
      },
    ],
  }),
}
