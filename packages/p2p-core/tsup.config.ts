import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    relay: 'src/relay.ts',
    constants: 'src/constants.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'esnext',
  treeshake: true,
  splitting: false,
  tsconfig: 'tsconfig.dts.json',
})
