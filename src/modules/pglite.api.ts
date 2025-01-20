import { PGliteWorker } from '@electric-sql/pglite/worker'

let pgInstance: PGliteWorker | null = null

export const getDatabase = (name: string): PGliteWorker => {
  if (!pgInstance) {
    pgInstance = new PGliteWorker(
      new Worker(new URL('./pglite.worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
        dataDir: `idb://${name}0.1`,
        meta: {
          // additional metadata passed to `init`
        },
      },
    )
  }
  return pgInstance
}
