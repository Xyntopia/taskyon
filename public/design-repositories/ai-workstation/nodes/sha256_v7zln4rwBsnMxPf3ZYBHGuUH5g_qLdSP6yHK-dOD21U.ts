export default {
  formatVersion: 2,
  id: 'sha256:v7zln4rwBsnMxPf3ZYBHGuUH5g_qLdSP6yHK-dOD21U',
  localName: 'model_memory_estimate',
  label: 'Model Memory Estimate',
  version: 1,
  localParamsSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  outputSchema: {
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
  inputs: {
    requirements: {
      nodeId: 'sha256:GygE4bN_4kbDjXcPjoF1FwGj39TgYTe0Vguwde5ZsrE',
      role: 'internal',
    },
  },
  run: async ({ use }) => {
    const input = await use.requirements({})
    const catalog = {
      'llama-3.1-8b': {
        parametersB: 8.03,
        layers: 32,
        kvHeads: 8,
        headDim: 128,
        sourceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/blob/main/config.json',
      },
      'qwen2.5-32b': {
        parametersB: 32.5,
        layers: 64,
        kvHeads: 8,
        headDim: 128,
        sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-32B-Instruct/blob/main/config.json',
      },
      'llama-3.3-70b': {
        parametersB: 70.6,
        layers: 80,
        kvHeads: 8,
        headDim: 128,
        sourceUrl: 'https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct/blob/main/config.json',
      },
    }
    const model = catalog[input.model]
    const bytesPerWeight = { q4: 0.5, q8: 1, fp16: 2 }[input.quantization]
    const gib = 1024 ** 3
    const weightsGb = (model.parametersB * 1e9 * bytesPerWeight) / gib
    const kvCacheGb =
      (2 *
        model.layers *
        model.kvHeads *
        model.headDim *
        input.contextTokens *
        2 *
        input.concurrency) /
      gib
    const runtimeOverheadGb = 2 + weightsGb * 0.08
    const requiredVramGb = Math.ceil((weightsGb + kvCacheGb + runtimeOverheadGb) * 1.1 * 10) / 10
    return {
      model: input.model,
      quantization: input.quantization,
      contextTokens: input.contextTokens,
      concurrency: input.concurrency,
      weightsGb: Math.round(weightsGb * 10) / 10,
      kvCacheGb: Math.round(kvCacheGb * 10) / 10,
      runtimeOverheadGb: Math.round(runtimeOverheadGb * 10) / 10,
      requiredVramGb,
      sourceUrl: model.sourceUrl,
    }
  },
}
