import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/taskyonCli.ts',
    'nlp.worker': '../taskyon/src/utils/nlp.worker.ts',
    denoWorkerSandboxRuntime: '../common/modules/sandbox/denoWorkerSandboxRuntime.ts',
    nodeWorkerSandboxRuntime: '../common/modules/sandbox/nodeWorkerSandboxRuntime.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  bundle: true,
  treeshake: true,
  external: [
    '@electric-sql/pglite',
    '@electric-sql/pglite/*',
    '@huggingface/transformers',
    'onnxruntime-node',
    'onnxruntime-common',
  ],
})
