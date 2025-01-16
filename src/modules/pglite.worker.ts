// my-pglite-worker.js
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'

worker({
  async init() {
    // Create and return a PGlite instance
    return new PGlite()
  },
})
