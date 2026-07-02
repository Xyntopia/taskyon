import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:PsETp82Q2aOeDtQPyMBEYct34MXnHOcSe57ZCn5qy78',
  localName: 'power_budget_check',
  label: 'Power Budget Check',
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
    requirements: {
      nodeId: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
      role: 'internal',
    },
    vram: {
      nodeId: 'sha256:DXnSt8c4sJcp_Rv_kf6JtVcaU6CR4Ki6pq7UxPXrAbM',
      role: 'internal',
    },
  },
  run: async ({ inputs }) => {
    const systemBaseW = 220
    return {
      candidates: inputs.vram.candidates.map((gpu) => ({
        ...gpu,
        estimatedSystemPowerW: gpu.boardPowerW + systemBaseW,
        powerHeadroomW: inputs.requirements.powerLimitW - (gpu.boardPowerW + systemBaseW),
        powerOk: gpu.boardPowerW + systemBaseW <= inputs.requirements.powerLimitW,
      })),
    }
  },
} satisfies StoredDagNodeModule
