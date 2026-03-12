import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@taskyon\/p2p-core$/, replacement: path.resolve(__dirname, '../p2p-core/src/index.ts') },
      { find: /^@taskyon\/p2p-core\/(.*)$/, replacement: path.resolve(__dirname, '../p2p-core/src/$1') },
    ],
  },
  build: {
    target: 'node22',
    outDir: 'dist',
    ssr: path.resolve(__dirname, 'relay.ts'),
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
      ],
      output: {
        format: 'es',
        entryFileNames: 'relay.mjs',
      },
    },
    minify: false,
  },
})
