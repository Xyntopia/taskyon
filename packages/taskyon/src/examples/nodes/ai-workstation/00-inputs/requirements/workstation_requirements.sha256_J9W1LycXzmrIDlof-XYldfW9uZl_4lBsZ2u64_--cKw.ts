import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
  localName: 'workstation_requirements',
  label: 'Workstation Requirements',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {
      budgetUsd: {
        default: 2600,
        type: 'number',
      },
      powerLimitW: {
        default: 850,
        type: 'number',
      },
      region: {
        default: 'US',
        type: 'string',
      },
      requiredVramGb: {
        default: 24,
        type: 'number',
      },
      targetModels: {
        default: ['llama-3.1-70b-q4', 'mixtral-8x7b-q4'],
        items: {
          type: 'string',
        },
        type: 'array',
      },
      utilization: {
        default: 0.7,
        type: 'number',
      },
    },
    required: [],
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      budgetUsd: {
        type: 'number',
      },
      powerLimitW: {
        type: 'number',
      },
      region: {
        type: 'string',
      },
      requiredVramGb: {
        type: 'number',
      },
      targetModels: {
        items: {
          type: 'string',
        },
        type: 'array',
      },
      utilization: {
        type: 'number',
      },
      weights: {
        additionalProperties: false,
        properties: {
          cost: {
            type: 'number',
          },
          performance: {
            type: 'number',
          },
          power: {
            type: 'number',
          },
          vram: {
            type: 'number',
          },
        },
        required: ['cost', 'power', 'vram', 'performance'],
        type: 'object',
      },
    },
    required: [
      'budgetUsd',
      'powerLimitW',
      'region',
      'requiredVramGb',
      'targetModels',
      'utilization',
      'weights',
    ],
    type: 'object',
  },
  inputs: {},
  run: async ({ params }) => ({
    budgetUsd: params.budgetUsd,
    powerLimitW: params.powerLimitW,
    region: params.region,
    requiredVramGb: params.requiredVramGb,
    targetModels: params.targetModels,
    utilization: params.utilization,
    weights: {
      cost: 0.34,
      power: 0.18,
      vram: 0.32,
      performance: 0.16,
    },
  }),
} satisfies StoredDagNodeModule
