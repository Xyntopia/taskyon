import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default {
  id: 'sha256:Bv5E_2j7KaO6ya9S8P9piQFm2t9bJMDunMYXNskPBOo',
  localName: 'model_requirements',
  label: 'Model Requirements',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      notes: {
        items: {
          additionalProperties: false,
          properties: {
            minimumVramGb: {
              type: 'number',
            },
            name: {
              type: 'string',
            },
            precision: {
              type: 'string',
            },
          },
          required: ['name', 'minimumVramGb', 'precision'],
          type: 'object',
        },
        type: 'array',
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
    },
    required: ['requiredVramGb', 'targetModels', 'notes'],
    type: 'object',
  },
  inputs: {
    requirements: {
      nodeId: 'sha256:J9W1LycXzmrIDlof-XYldfW9uZl_4lBsZ2u64_--cKw',
      role: 'internal',
    },
  },
  run: async ({ inputs }) => {
    const requirements = inputs.requirements
    return {
      targetModels: requirements.targetModels,
      requiredVramGb: requirements.requiredVramGb,
      notes: requirements.targetModels.map((name) => ({
        name,
        minimumVramGb: requirements.requiredVramGb,
        precision: 'q4',
      })),
    }
  },
} satisfies StoredDagNodeModule
