export default {
  formatVersion: 2,
  id: 'sha256:WSsWYvUXCvnufHTyHGJntFnikbuGaAte0zFHFaQcb1w',
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
        id: 'aurora-27u',
        name: 'Aurora 27U Microsat',
        costUsd: 2850000,
        capacity: 24,
        massKg: 92,
        powerW: 510,
        performance: 93,
        reliability: 92,
      },
      {
        id: 'pioneer-12u',
        name: 'Pioneer 12U CubeSat',
        costUsd: 1180000,
        capacity: 12,
        massKg: 38,
        powerW: 240,
        performance: 78,
        reliability: 88,
      },
      {
        id: 'relay-espa',
        name: 'Relay ESPA-Class',
        costUsd: 4600000,
        capacity: 42,
        massKg: 168,
        powerW: 760,
        performance: 97,
        reliability: 95,
      },
      {
        id: 'hosted-orbit',
        name: 'Hosted Orbit Payload',
        costUsd: 2100000,
        capacity: 20,
        massKg: 54,
        powerW: 330,
        performance: 86,
        reliability: 89,
      },
    ],
  }),
}
