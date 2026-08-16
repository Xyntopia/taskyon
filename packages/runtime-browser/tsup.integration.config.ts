import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    core: 'src/core.ts',
    cryptoSession: 'src/persistentCryptoSession.ts',
  },
  outDir: process.env.TASKYON_RUNTIME_BROWSER_OUT_DIR ?? 'dist-integration',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'esnext',
  treeshake: true,
  splitting: true,
  external: ['@taskyon/taskyon'],
  noExternal: ['@taskyon/common', '@taskyon/comp-dag'],
  tsconfig: 'tsconfig.json',
})
