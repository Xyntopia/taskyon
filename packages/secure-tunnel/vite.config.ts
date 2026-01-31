import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SecureTunnel',
      fileName: 'secure-tunnel',
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {}
      }
    },
    sourcemap: true,
    minify: 'esbuild'
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'globalThis'
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      process: 'process/browser',
      stream: 'stream-browserify',
      crypto: 'crypto-browserify'
    }
  }
});
