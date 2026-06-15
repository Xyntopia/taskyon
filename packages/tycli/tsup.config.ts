import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'nlp.worker': '../taskyon/src/utils/nlp.worker.ts',
    'pyodide.worker': '../taskyon/src/utils/pyodide.worker.ts',
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
