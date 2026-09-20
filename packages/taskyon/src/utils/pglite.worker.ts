//pglite.worker.ts
// check out this for more info: https://pglite.dev/docs/multi-tab-workers
import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'

const isClosedBroadcastChannelError = (value: unknown): boolean =>
  value instanceof Error &&
  value.name === 'InvalidStateError' &&
  value.message.includes('BroadcastChannel')

// PGlite's multi-tab worker can answer a peer whose tab channel closed while the request was still
// in flight. That teardown race is benign and must not surface as an uncaught host-application error.
self.addEventListener('error', (event) => {
  if (isClosedBroadcastChannelError(event.error)) event.preventDefault()
})
self.addEventListener('unhandledrejection', (event) => {
  if (isClosedBroadcastChannelError(event.reason)) event.preventDefault()
})

void worker({
  // eslint-disable-next-line @typescript-eslint/require-await
  async init(options) {
    //const meta = options.meta
    // Create and return a PGlite instance
    // Do something with additional metadata.
    // or even run your own code in the leader along side the PGlite
    const dataDir = options.dataDir || 'memory://'
    console.log('using dataDir:', dataDir)
    return new PGlite({
      dataDir,
      extensions: {
        vector,
      },
      // https://pglite.dev/docs/api
      relaxedDurability: true, // this speeds up our pglite database significantly when run in indexdb
    })
  },
})
