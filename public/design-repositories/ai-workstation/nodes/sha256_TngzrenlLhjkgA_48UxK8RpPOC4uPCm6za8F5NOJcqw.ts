export default {
  formatVersion: 2,
  id: 'sha256:TngzrenlLhjkgA_48UxK8RpPOC4uPCm6za8F5NOJcqw',
  localName: 'selected_workstation_configuration',
  label: 'Selected Workstation Configuration',
  version: 1,
  structure: {
    kind: 'explode',
    path: 'configurations',
    sourceAlias: 'source',
  },
  localParamsSchema: {},
  outputSchema: {
    additionalProperties: false,
    properties: {
      aggregateVramGb: {
        type: 'number',
      },
      backend: {
        enum: ['cuda', 'metal'],
        type: 'string',
      },
      configuration: {
        type: 'string',
      },
      estimatedPriceUsd: {
        type: 'number',
      },
      estimatedSystemPowerW: {
        type: 'number',
      },
      gpu: {
        type: 'string',
      },
      gpuCount: {
        type: 'integer',
      },
      id: {
        type: 'string',
      },
      noiseClass: {
        enum: ['quiet', 'standard', 'loud'],
        type: 'string',
      },
      perfIndex: {
        type: 'number',
      },
      priceKind: {
        type: 'string',
      },
      sourceDate: {
        type: 'string',
      },
      sourceUrl: {
        type: 'string',
      },
      storageTb: {
        type: 'number',
      },
      systemRamGb: {
        type: 'number',
      },
      usableVramGb: {
        type: 'number',
      },
    },
    required: [
      'id',
      'configuration',
      'gpu',
      'gpuCount',
      'usableVramGb',
      'aggregateVramGb',
      'systemRamGb',
      'storageTb',
      'estimatedPriceUsd',
      'priceKind',
      'estimatedSystemPowerW',
      'perfIndex',
      'noiseClass',
      'backend',
      'sourceUrl',
      'sourceDate',
    ],
    type: 'object',
  },
  inputs: {
    source: {
      nodeId: 'sha256:039gEFdzfKtvphe1DPBgNiGvzNJbh8y9BusrnvqrfYY',
      role: 'internal',
    },
  },
  run: () => {
    throw new Error('Structural nodes are compiled by the design graph engine')
  },
}
