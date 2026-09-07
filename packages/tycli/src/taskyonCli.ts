const startupStartedAt = performance.now()
if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
  process.stderr.write('[startup] Loading interactive shell...\n')
}
void Promise.all([import('./cli'), import('./taskyonHost')])
  .then(([{ runInteractiveCli }, { createTaskyonInteractiveCliHost }]) =>
    runInteractiveCli({ ...createTaskyonInteractiveCliHost(), startupStartedAt }),
  )
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
