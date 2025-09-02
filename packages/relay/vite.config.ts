// vite.config.relay.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/p2p/relay.ts',
      formats: ['cjs'],
      fileName: 'relay',
    },
    rollupOptions: {
      external: ['node:fs', 'node:path'], // and maybe libp2p internals if bundling fails
    },
    target: 'node18',
  },
})
