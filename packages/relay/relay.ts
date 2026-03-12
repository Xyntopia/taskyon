import { createStdoutLogger, startRelayLibp2p } from '@taskyon/p2p-core/relay'

const log = createStdoutLogger('relay')

startRelayLibp2p().catch((err: unknown) => {
  const error = err as Error & { code?: string }
  log.error('=== FATAL ERROR ===')
  log.error('Failed to start relay server:')
  log.error(`Error name: ${error.name}`)
  log.error(`Error message: ${error.message}`)
  log.error(`Error stack: ${error.stack}`)

  if (error.code) {
    log.error(`Error code: ${error.code}`)
  }

  if (error.message.includes('does not provide an export')) {
    log.error('This appears to be an import/export error.')
    log.error('Check that all @libp2p packages are compatible versions.')
  }

  if (error.message.includes('Cannot resolve module')) {
    log.error('This appears to be a missing dependency.')
    log.error('Try running yarn install in frontend/.')
  }

  process.exit(1)
})
