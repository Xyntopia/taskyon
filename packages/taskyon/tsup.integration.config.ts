import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    api: 'src/api/index.ts',
    chat: 'src/chat.ts',
    'chat-ui': 'src/chat-ui.ts',
    db: 'src/db.ts',
    'nlp.worker': 'src/utils/nlp.worker.ts',
    'pglite.worker': 'src/utils/pglite.worker.ts',
    runtimeCore: 'src/runtimeCore.ts',
    entryNode: 'src/tools/entryNode.ts',
    'taskyon-space': 'src/taskyon.space/public.ts',
  },
  outDir: process.env.TASKYON_PACKAGE_OUT_DIR ?? 'dist-integration',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'esnext',
  platform: 'browser',
  treeshake: true,
  splitting: true,
  external: ['@taskyon/p2p-core'],
  noExternal: ['@taskyon/common', '@taskyon/comp-dag'],
  tsconfig: 'tsconfig.json',
})
