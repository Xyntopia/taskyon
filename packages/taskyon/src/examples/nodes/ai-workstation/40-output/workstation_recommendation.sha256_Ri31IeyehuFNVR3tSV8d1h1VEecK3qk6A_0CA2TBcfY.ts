import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:Ri31IeyehuFNVR3tSV8d1h1VEecK3qk6A_0CA2TBcfY',
  localName: 'workstation_recommendation',
  label: 'Workstation Recommendation',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      constraints: {
        additionalProperties: false,
        properties: {
          budgetUsd: {
            type: 'number',
          },
          powerLimitW: {
            type: 'number',
          },
          requiredVramGb: {
            type: 'number',
          },
        },
        required: ['budgetUsd', 'powerLimitW', 'requiredVramGb'],
        type: 'object',
      },
      ranked: {
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
      recommendation: {
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
      viableCount: {
        type: 'number',
      },
    },
    required: ['constraints', 'ranked', 'recommendation', 'viableCount'],
    type: 'object',
  },
  inputs: {
    ranked: {
      nodeId: 'sha256:IIDfWyO3YP0HfxCvyWEsBX7iRyweYNNAzHYZjhKzcUM',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
      role: 'exposed',
    },
  },
  run: async ({ inputs }) => {
    const best = inputs.ranked.viable[0] ?? inputs.ranked.ranked[0]
    return {
      recommendation: best,
      viableCount: inputs.ranked.viable.length,
      ranked: inputs.ranked.ranked,
      constraints: {
        budgetUsd: inputs.requirements.budgetUsd,
        powerLimitW: inputs.requirements.powerLimitW,
        requiredVramGb: inputs.requirements.requiredVramGb,
      },
    }
  },
} satisfies StoredDagNodeModule
