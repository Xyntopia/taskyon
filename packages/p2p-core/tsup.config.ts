import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    node: 'src/node.ts',
    relay: 'src/relay.ts',
    constants: 'src/constants.ts',
    discovery: 'src/discovery.ts',
    p2pBus: 'src/p2pBus.ts',
    p2pManager: 'src/p2pManager.ts',
    stream: 'src/stream.ts',
    messagePort: 'src/messagePort.ts',
    testNetworks: 'src/testNetworks.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'esnext',
  treeshake: true,
  splitting: false,
  tsconfig: 'tsconfig.dts.json',
})
