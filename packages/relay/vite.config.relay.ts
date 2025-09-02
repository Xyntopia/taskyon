// vite.config.relay.ts
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    target: 'node18', // match your Docker Node version
    outDir: 'dist',
    lib: {
      entry: path.resolve(__dirname, 'packages/relay/relay.js'),
      formats: ['cjs'], // Node.js CommonJS
      fileName: 'relay',
    },
    rollupOptions: {
      external: ['fs', 'path', 'os', 'util', 'stream', 'buffer', 'events'],
    },
    minify: false, // optional: can minify for smaller size
  },
})
