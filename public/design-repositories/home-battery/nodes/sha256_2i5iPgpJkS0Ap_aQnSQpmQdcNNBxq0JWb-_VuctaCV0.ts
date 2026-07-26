export default {
  formatVersion: 2,
  id: 'sha256:2i5iPgpJkS0Ap_aQnSQpmQdcNNBxq0JWb-_VuctaCV0',
  localName: 'battery_recommendation',
  label: 'Home Battery System Recommendation',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: true,
    properties: {
      constraints: {
        additionalProperties: true,
        properties: {
          budgetUsd: {
            type: 'number',
          },
          maxMassKg: {
            type: 'number',
          },
          maxPowerW: {
            type: 'number',
          },
          minCapacity: {
            type: 'number',
          },
        },
        type: 'object',
      },
      ranked: {
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
      recommendation: {
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
      viableCount: {
        type: 'number',
      },
    },
    required: ['recommendation', 'ranked', 'viableCount', 'constraints'],
    type: 'object',
  },
  inputs: {
    ranked: {
      nodeId: 'sha256:dQKY4N14QSfu4kT-hHg8GBpTi0d3pvzQBD2wuNTT4tg',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:8-eiDExF1j-oilsD5CNykl5syV_ZMfZwMMn6TK3noCs',
      role: 'exposed',
    },
  },
  run: async ({ use }) => {
    const scored = await use.ranked({})
    const requirements = await use.requirements({})
    return {
      recommendation: scored.viable[0] ?? scored.ranked[0],
      ranked: scored.ranked,
      viableCount: scored.viable.length,
      constraints: requirements,
    }
  },
}
