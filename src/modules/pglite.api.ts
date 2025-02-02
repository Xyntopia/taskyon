import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'

export type TyPGDB = PGliteWorker & { live: LiveNamespace }

let pgInstance: TyPGDB | null = null

export const getDatabase = async (name: string): Promise<TyPGDB> => {
  if (!pgInstance) {
    pgInstance = await PGliteWorker.create(
      new Worker(new URL('./pglite.worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
        dataDir: `idb://${name}0.1`,
        meta: {
          // additional metadata passed to `init`
        },
        // we can do this here instead of inside the worker, because it only uses the PGlite plugin interface
        // https://pglite.dev/docs/multi-tab-worker#extension-support
        extensions: {
          live,
        },
      },
    )
  }
  return pgInstance
}
