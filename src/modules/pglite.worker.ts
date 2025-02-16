// check out this for more info: https://pglite.dev/docs/multi-tab-workers
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'

void worker({
  // eslint-disable-next-line @typescript-eslint/require-await
  async init(options) {
    //const meta = options.meta
    // Create and return a PGlite instance
    // Do something with additional metadata.
    // or even run your own code in the leader along side the PGlite
    return new PGlite({
      dataDir: options.dataDir || 'taskyon0.0',
      extensions: {
        vector,
      },
      // https://pglite.dev/docs/api
      relaxedDurability: true, // this speeds up our pglite database significantly when run in indexdb
    })
  },
})
