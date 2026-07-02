import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:_Zl4YygvhDrgQBaTJOWJq4_Ul5j6uriZohO3N2NBGI8',
  localName: 'cost_check',
  label: 'Cost Check',
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
    power: {
      nodeId: 'sha256:PsETp82Q2aOeDtQPyMBEYct34MXnHOcSe57ZCn5qy78',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
      role: 'internal',
    },
  },
  run: async ({ inputs }) => ({
    candidates: inputs.power.candidates.map((gpu) => ({
      ...gpu,
      budgetRemainingUsd: inputs.requirements.budgetUsd - gpu.priceUsd,
      budgetOk: gpu.priceUsd <= inputs.requirements.budgetUsd,
    })),
  }),
} satisfies StoredDagNodeModule
