import { noopCliFooter, type CliFooter } from './types'

export type { CliFooter, CliFooterStatus, CliTaskState } from './types'

export async function createCliFooter(): Promise<CliFooter> {
  if ((process.env.TYCLI_TERMINAL_UI ?? '').trim().toLowerCase() !== 'terminal-kit') {
    return noopCliFooter()
  }
  const { createTerminalKitFooter } = await import('./terminalKitFooter')
  return await createTerminalKitFooter()
}
