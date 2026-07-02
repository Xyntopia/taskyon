import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:HWdlsRpCG0gFoQUoTrZYLOnncVJHgLOCSCSMNWfJIKg',
  localName: 'gpu_candidates',
  label: 'GPU Candidates',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      candidates: {
        items: {
          additionalProperties: true,
          properties: {
            boardPowerW: {
              type: 'number',
            },
            budgetOk: {
              type: 'boolean',
            },
            budgetRemainingUsd: {
              type: 'number',
            },
            estimatedSystemPowerW: {
              type: 'number',
            },
            id: {
              type: 'string',
            },
            name: {
              type: 'string',
            },
            perfIndex: {
              type: 'number',
            },
            powerHeadroomW: {
              type: 'number',
            },
            powerOk: {
              type: 'boolean',
            },
            priceUsd: {
              type: 'number',
            },
            requiredVramGb: {
              type: 'number',
            },
            score: {
              type: 'number',
            },
            viable: {
              type: 'boolean',
            },
            vramGb: {
              type: 'number',
            },
            vramMarginGb: {
              type: 'number',
            },
            vramOk: {
              type: 'boolean',
            },
          },
          required: ['id', 'name', 'vramGb', 'priceUsd', 'boardPowerW', 'perfIndex'],
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
    sources: [
      {
        title: 'Static demo candidate table',
        url: 'taskyon://examples/ai-workstation/gpu-candidates',
      },
    ],
    candidates: [
      {
        id: 'rtx-4090',
        name: 'RTX 4090',
        vramGb: 24,
        priceUsd: 1799,
        boardPowerW: 450,
        perfIndex: 100,
      },
      {
        id: 'rtx-5090',
        name: 'RTX 5090',
        vramGb: 32,
        priceUsd: 2499,
        boardPowerW: 575,
        perfIndex: 135,
      },
      {
        id: 'rtx-5080',
        name: 'RTX 5080',
        vramGb: 16,
        priceUsd: 1199,
        boardPowerW: 360,
        perfIndex: 92,
      },
      {
        id: 'rtx-6000-ada',
        name: 'RTX 6000 Ada',
        vramGb: 48,
        priceUsd: 6800,
        boardPowerW: 300,
        perfIndex: 96,
      },
      {
        id: 'rtx-4080-super',
        name: 'RTX 4080 Super',
        vramGb: 16,
        priceUsd: 999,
        boardPowerW: 320,
        perfIndex: 78,
      },
      {
        id: 'rtx-3090-used',
        name: 'RTX 3090 Used',
        vramGb: 24,
        priceUsd: 850,
        boardPowerW: 350,
        perfIndex: 68,
      },
    ],
  }),
} satisfies StoredDagNodeModule
