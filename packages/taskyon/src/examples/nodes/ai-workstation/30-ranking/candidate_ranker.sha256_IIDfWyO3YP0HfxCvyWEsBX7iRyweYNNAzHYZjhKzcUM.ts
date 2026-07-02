import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:IIDfWyO3YP0HfxCvyWEsBX7iRyweYNNAzHYZjhKzcUM',
  localName: 'candidate_ranker',
  label: 'Candidate Ranker',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
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
      viable: {
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
    required: ['ranked', 'viable'],
    type: 'object',
  },
  inputs: {
    checked: {
      nodeId: 'sha256:_Zl4YygvhDrgQBaTJOWJq4_Ul5j6uriZohO3N2NBGI8',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
      role: 'internal',
    },
  },
  run: async ({ inputs }) => {
    const weights = inputs.requirements.weights
    const budget = inputs.requirements.budgetUsd
    const powerLimit = inputs.requirements.powerLimitW
    const ranked = inputs.checked.candidates
      .map((gpu) => {
        const viabilityPenalty = gpu.vramOk && gpu.powerOk && gpu.budgetOk ? 0 : 1000
        const costScore = Math.max(0, 1 - gpu.priceUsd / budget) * 100
        const powerScore = Math.max(0, gpu.powerHeadroomW / powerLimit) * 100
        const vramScore = Math.max(0, gpu.vramMarginGb) * 4
        const performanceScore = gpu.perfIndex
        const score =
          weights.cost * costScore +
          weights.power * powerScore +
          weights.vram * vramScore +
          weights.performance * performanceScore -
          viabilityPenalty
        return {
          ...gpu,
          score: Math.round(score * 10) / 10,
          viable: gpu.vramOk && gpu.powerOk && gpu.budgetOk,
        }
      })
      .sort((a, b) => b.score - a.score)
    return {
      ranked,
      viable: ranked.filter((gpu) => gpu.viable),
    }
  },
} satisfies StoredDagNodeModule
