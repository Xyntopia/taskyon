export default {
  formatVersion: 3,
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: true,
    properties: {
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
      viable: {
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
    required: ['ranked', 'viable'],
    type: 'object',
  },
  run: async ({ use }) => {
    const requirements = await use.requirements({})
    const source = await use.candidates({})
    const ranked = source.candidates
      .map((candidate) => {
        const budgetOk = candidate.costUsd <= requirements.budgetUsd
        const capacityOk = candidate.capacity >= requirements.minCapacity
        const massOk = candidate.massKg <= requirements.maxMassKg
        const powerOk = candidate.powerW <= requirements.maxPowerW
        const viable = budgetOk && capacityOk && massOk && powerOk
        const affordability = Math.max(0, 1 - candidate.costUsd / requirements.budgetUsd) * 100
        const capacityMargin = Math.max(0, candidate.capacity - requirements.minCapacity)
        const efficiency = Math.max(0, 1 - candidate.powerW / requirements.maxPowerW) * 100
        const weight = requirements.performanceWeight
        const score =
          weight * candidate.performance +
          (1 - weight) * (affordability * 0.45 + efficiency * 0.35 + capacityMargin * 0.2) -
          (viable ? 0 : 1000)
        return { ...candidate, budgetOk, capacityOk, massOk, powerOk, viable, score }
      })
      .sort((a, b) => b.score - a.score)
    return { ranked, viable: ranked.filter((candidate) => candidate.viable) }
  },
  ids: {
    constraint_scoring: {
      label: 'Constraint & Score Evaluation',
      inputs: {
        candidates: { source: 'design_candidates', role: 'internal' },
        requirements: { source: 'mission_requirements', role: 'internal' },
      },
    },
  },
}
