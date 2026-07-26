export default {
  formatVersion: 2,
  id: 'sha256:ZS47WA2w3T-O_r1dwR4NvuSvNLcLlPcZozHNQRxfxgM',
  localName: 'workstation_recommendation',
  label: 'AI Workstation Design Result',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
    additionalProperties: false,
    properties: {
      assumptions: {
        items: {
          type: 'string',
        },
        type: 'array',
      },
      constraints: {
        items: {
          additionalProperties: false,
          properties: {
            actual: {
              type: ['boolean', 'number', 'string'],
            },
            explanation: {
              type: 'string',
            },
            id: {
              type: 'string',
            },
            label: {
              type: 'string',
            },
            limit: {
              type: ['boolean', 'number', 'string'],
            },
            status: {
              enum: ['pass', 'fail', 'warning'],
              type: 'string',
            },
            unit: {
              type: 'string',
            },
          },
          required: ['id', 'label', 'status', 'actual', 'limit', 'unit', 'explanation'],
          type: 'object',
        },
        type: 'array',
      },
      evidence: {
        additionalProperties: false,
        properties: {
          configurationSource: {
            type: 'string',
          },
          modelSource: {
            type: 'string',
          },
          priceBasis: {
            type: 'string',
          },
        },
        required: ['configurationSource', 'modelSource', 'priceBasis'],
        type: 'object',
      },
      modelEstimate: {
        additionalProperties: false,
        properties: {
          concurrency: {
            type: 'number',
          },
          contextTokens: {
            type: 'number',
          },
          kvCacheGb: {
            type: 'number',
          },
          model: {
            type: 'string',
          },
          quantization: {
            type: 'string',
          },
          requiredVramGb: {
            type: 'number',
          },
          runtimeOverheadGb: {
            type: 'number',
          },
          sourceUrl: {
            type: 'string',
          },
          weightsGb: {
            type: 'number',
          },
        },
        required: [
          'model',
          'quantization',
          'contextTokens',
          'concurrency',
          'weightsGb',
          'kvCacheGb',
          'runtimeOverheadGb',
          'requiredVramGb',
          'sourceUrl',
        ],
        type: 'object',
      },
      recommendation: {
        additionalProperties: true,
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
          rejectedReasons: {
            items: {
              type: 'string',
            },
            type: 'array',
          },
          score: {
            type: 'number',
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
          viable: {
            type: 'boolean',
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
          'score',
          'viable',
          'rejectedReasons',
        ],
        type: 'object',
      },
      requirements: {
        additionalProperties: false,
        properties: {
          budgetUsd: {
            default: 5500,
            description: 'Maximum planning budget for the complete workstation',
            minimum: 500,
            type: 'number',
          },
          concurrency: {
            default: 1,
            description: 'Simultaneous model requests',
            maximum: 16,
            minimum: 1,
            type: 'integer',
          },
          contextTokens: {
            default: 32768,
            description: 'Maximum tokens retained per simultaneous request',
            maximum: 262144,
            minimum: 2048,
            type: 'integer',
          },
          minimumSystemRamGb: {
            default: 64,
            description: 'Minimum acceptable system memory',
            minimum: 16,
            type: 'integer',
          },
          model: {
            default: 'qwen2.5-32b',
            enum: ['llama-3.1-8b', 'qwen2.5-32b', 'llama-3.3-70b'],
            type: 'string',
          },
          noisePreference: {
            default: 'any',
            enum: ['any', 'quiet'],
            type: 'string',
          },
          powerLimitW: {
            default: 1200,
            description: 'Maximum estimated wall power under sustained inference',
            minimum: 250,
            type: 'number',
          },
          quantization: {
            default: 'q4',
            enum: ['q4', 'q8', 'fp16'],
            type: 'string',
          },
          region: {
            default: 'US',
            enum: ['US'],
            type: 'string',
          },
          runtime: {
            default: 'any',
            enum: ['any', 'cuda', 'metal'],
            type: 'string',
          },
        },
        required: [
          'budgetUsd',
          'concurrency',
          'contextTokens',
          'minimumSystemRamGb',
          'model',
          'noisePreference',
          'powerLimitW',
          'quantization',
          'region',
          'runtime',
        ],
        type: 'object',
      },
    },
    required: [
      'recommendation',
      'requirements',
      'modelEstimate',
      'constraints',
      'assumptions',
      'evidence',
    ],
    type: 'object',
  },
  inputs: {
    candidate: {
      nodeId: 'sha256:TngzrenlLhjkgA_48UxK8RpPOC4uPCm6za8F5NOJcqw',
      role: 'exposed',
    },
    modelEstimate: {
      nodeId: 'sha256:v7zln4rwBsnMxPf3ZYBHGuUH5g_qLdSP6yHK-dOD21U',
      role: 'internal',
    },
    requirements: {
      nodeId: 'sha256:GygE4bN_4kbDjXcPjoF1FwGj39TgYTe0Vguwde5ZsrE',
      role: 'exposed',
    },
  },
  run: async ({ use }) => {
    const candidate = await use.candidate()
    const requirements = await use.requirements()
    const modelEstimate = await use.modelEstimate({})
    const memoryActual =
      candidate.backend === 'metal' ? candidate.usableVramGb : candidate.usableVramGb
    const memoryOk = memoryActual >= modelEstimate.requiredVramGb
    const budgetOk = candidate.estimatedPriceUsd <= requirements.budgetUsd
    const powerOk = candidate.estimatedSystemPowerW <= requirements.powerLimitW
    const ramOk = candidate.systemRamGb >= requirements.minimumSystemRamGb
    const runtimeOk = requirements.runtime === 'any' || candidate.backend === requirements.runtime
    const noiseOk = requirements.noisePreference !== 'quiet' || candidate.noiseClass === 'quiet'
    const constraints = [
      {
        id: 'memory-fit',
        label: 'Model memory fit',
        status: memoryOk ? 'pass' : 'fail',
        actual: memoryActual,
        limit: modelEstimate.requiredVramGb,
        unit: 'GB',
        explanation:
          'Usable memory must cover weights, KV cache, runtime overhead, and 10% headroom.',
      },
      {
        id: 'budget',
        label: 'Complete system budget',
        status: budgetOk ? 'pass' : 'fail',
        actual: candidate.estimatedPriceUsd,
        limit: requirements.budgetUsd,
        unit: 'USD',
        explanation: 'Planning estimate compared with the maximum complete-system budget.',
      },
      {
        id: 'power',
        label: 'Sustained system power',
        status: powerOk ? 'pass' : 'fail',
        actual: candidate.estimatedSystemPowerW,
        limit: requirements.powerLimitW,
        unit: 'W',
        explanation: 'Estimated sustained inference power, not a certified wall measurement.',
      },
      {
        id: 'system-ram',
        label: 'System memory',
        status: ramOk ? 'pass' : 'fail',
        actual: candidate.systemRamGb,
        limit: requirements.minimumSystemRamGb,
        unit: 'GB',
        explanation: 'Installed system memory compared with the stated minimum.',
      },
      {
        id: 'runtime',
        label: 'Runtime compatibility',
        status: runtimeOk ? 'pass' : 'fail',
        actual: candidate.backend,
        limit: requirements.runtime,
        unit: 'backend',
        explanation: 'CUDA and Metal are treated as distinct deployment backends.',
      },
      {
        id: 'noise',
        label: 'Acoustic preference',
        status: noiseOk ? 'pass' : 'warning',
        actual: candidate.noiseClass,
        limit: requirements.noisePreference,
        unit: 'class',
        explanation: 'Noise is a preference and does not make a design infeasible.',
      },
    ]
    const hardFailures = constraints.filter((item) => item.status === 'fail')
    const viable = hardFailures.length === 0
    const budgetValue = Math.max(0, 1 - candidate.estimatedPriceUsd / requirements.budgetUsd)
    const memoryHeadroom = Math.max(
      0,
      Math.min(1, (memoryActual - modelEstimate.requiredVramGb) / modelEstimate.requiredVramGb),
    )
    const powerHeadroom = Math.max(
      0,
      1 - candidate.estimatedSystemPowerW / requirements.powerLimitW,
    )
    const performance = Math.min(1, candidate.perfIndex / 145)
    const score = viable
      ? Math.round(
          (budgetValue * 35 + memoryHeadroom * 25 + powerHeadroom * 15 + performance * 25) * 10,
        ) / 10
      : -1000 - hardFailures.length
    return {
      recommendation: {
        ...candidate,
        score,
        viable,
        rejectedReasons: hardFailures.map((item) => item.explanation),
      },
      requirements,
      modelEstimate,
      constraints,
      assumptions: [
        'Configuration prices are planning estimates, not live quotes.',
        'Multi-GPU aggregate VRAM is reported separately; a single model may require sharding support.',
        'Unified-memory availability is conservatively estimated for the selected Mac configuration.',
        'Validate thermals, motherboard lanes, PSU transients, and runtime support before purchasing.',
      ],
      evidence: {
        configurationSource: candidate.sourceUrl,
        modelSource: modelEstimate.sourceUrl,
        priceBasis: candidate.priceKind,
      },
    }
  },
}
