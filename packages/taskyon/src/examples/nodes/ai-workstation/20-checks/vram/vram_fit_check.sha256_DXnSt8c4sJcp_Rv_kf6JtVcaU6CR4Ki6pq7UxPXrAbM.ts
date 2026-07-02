import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:DXnSt8c4sJcp_Rv_kf6JtVcaU6CR4Ki6pq7UxPXrAbM',
  localName: 'vram_fit_check',
  label: 'VRAM Fit Check',
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
  inputs: {
    candidates: {
      nodeId: 'sha256:HWdlsRpCG0gFoQUoTrZYLOnncVJHgLOCSCSMNWfJIKg',
      role: 'internal',
    },
    models: {
      nodeId: 'sha256:Bv5E_2j7KaO6ya9S8P9piQFm2t9bJMDunMYXNskPBOo',
      role: 'internal',
    },
  },
  run: async ({ inputs }) => {
    const requiredVramGb = inputs.models.requiredVramGb
    return {
      candidates: inputs.candidates.candidates.map((gpu) => ({
        ...gpu,
        requiredVramGb,
        vramMarginGb: gpu.vramGb - requiredVramGb,
        vramOk: gpu.vramGb >= requiredVramGb,
      })),
    }
  },
} satisfies StoredDagNodeModule
