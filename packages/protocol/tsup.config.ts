import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    remoteError: 'src/remoteError.ts',
    requestLifecycle: 'src/requestLifecycle.ts',
    sensor: 'src/sensor.ts',
    transport: 'src/transport.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  treeshake: true,
})
