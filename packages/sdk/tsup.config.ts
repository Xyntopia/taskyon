import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: process.env.TASKYON_SDK_OUT_DIR ?? 'dist',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'esnext',
  treeshake: true,
  splitting: false,
  external: ['@taskyon/runtime-browser', '@taskyon/taskyon'],
  noExternal: ['@taskyon/common', '@noble/hashes'],
  tsconfig: 'tsconfig.json',
})
