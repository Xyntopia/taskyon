import { noopCliFooter, type CliFooter } from './types'

export type { CliFooter, CliFooterStatus, CliTaskState } from './types'

export async function createCliFooter(environmentPrefix = 'TYCLI'): Promise<CliFooter> {
  if (
    (process.env[`${environmentPrefix}_TERMINAL_UI`] ?? '').trim().toLowerCase() !== 'terminal-kit'
  ) {
    return noopCliFooter()
  }
  const { createTerminalKitFooter } = await import('./terminalKitFooter')
  return await createTerminalKitFooter(environmentPrefix)
}
