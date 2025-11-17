import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'dist',
    lib: {
      entry: path.resolve(__dirname, 'relay.js'),
      formats: ['cjs'],
      fileName: 'relay',
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      external: [
        'fs',
        'path',
        'os',
        'util',
        'stream',
        'buffer',
        'events',
        '@libp2p/tcp',
        '@libp2p/mplex', // or yamux if used
        '@libp2p/noise', // etc
        '@libp2p/websockets', // optional, if you mix
      ],
    },
    minify: false,
  },
})
