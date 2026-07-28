import { runInteractiveCli } from './cli'
import { createTaskyonInteractiveCliHost } from './taskyonHost'

void runInteractiveCli(createTaskyonInteractiveCliHost()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
