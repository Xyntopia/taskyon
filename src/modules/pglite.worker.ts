// check out this for more info: https://pglite.dev/docs/multi-tab-workers
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'

worker({
  async init(/*options*/) {
    //const meta = options.meta
    // Create and return a PGlite instance
    // Do something with additional metadata.
    // or even run your own code in the leader along side the PGlite
    return new PGlite({
      //dataDir: options.dataDir,
      extensions: {
        vector,
      },
    })
  },
})
