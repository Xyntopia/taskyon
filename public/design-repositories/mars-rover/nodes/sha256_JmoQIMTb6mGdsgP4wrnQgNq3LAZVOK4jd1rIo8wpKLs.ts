export default {
  formatVersion: 2,
  id: 'sha256:JmoQIMTb6mGdsgP4wrnQgNq3LAZVOK4jd1rIo8wpKLs',
  localName: 'rover_recommendation',
  label: 'Autonomous Mars Rover Recommendation',
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
      nodeId: 'sha256:R9A24gcmDjX3yhSUgguIryEkUHqHVHn1g2EljsfEq8M',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:SbqiYLA6nmSqnXC29hETtfhAS6DOf1W7ICeQlUcZemk',
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
