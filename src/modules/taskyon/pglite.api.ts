import { PGliteWorker } from '@electric-sql/pglite/worker'

export const pg = new PGliteWorker(
  new Worker(new URL('../pglite.worker.ts', import.meta.url), {
    type: 'module',
  }),
  /*{
    dataDir: 'idb://my-db',
    meta: {
      // additional metadata passed to `init`
    },
  },*/
)
