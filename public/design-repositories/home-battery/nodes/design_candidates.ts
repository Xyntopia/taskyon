export default {
  formatVersion: 2,
  id: 'sha256:eyBa6ShsylMpwau5N_2IGU_jkAzVfqFZI3MXOipH1Vg',
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
        id: 'modular-lfp-24',
        name: 'Modular LFP 24',
        costUsd: 18900,
        capacity: 24,
        massKg: 286,
        powerW: 12000,
        performance: 94,
        reliability: 96,
      },
      {
        id: 'compact-lfp-15',
        name: 'Compact LFP 15',
        costUsd: 12400,
        capacity: 15,
        massKg: 168,
        powerW: 9000,
        performance: 83,
        reliability: 94,
      },
      {
        id: 'whole-home-30',
        name: 'Whole Home 30',
        costUsd: 26500,
        capacity: 30,
        massKg: 342,
        powerW: 15000,
        performance: 98,
        reliability: 93,
      },
      {
        id: 'value-stack-21',
        name: 'Value Stack 21',
        costUsd: 16200,
        capacity: 21,
        massKg: 248,
        powerW: 10000,
        performance: 88,
        reliability: 91,
      },
    ],
  }),
}
