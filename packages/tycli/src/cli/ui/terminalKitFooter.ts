import { basename } from 'node:path'
import type * as TerminalKitModule from 'terminal-kit'
import { noopCliFooter, type CliFooter, type CliFooterStatus } from './types'

const isSupportedTerminal = (environmentPrefix: string) =>
  process.stdin.isTTY &&
  process.stdout.isTTY &&
  (process.env[`${environmentPrefix}_TERMINAL_UI`] ?? '').trim().toLowerCase() === 'terminal-kit' &&
  typeof process.stdout.rows === 'number' &&
  process.stdout.rows >= 5

const visibleName = (path: string | undefined) => (path ? basename(path) : 'n/a')

const truncate = (value: string, maxWidth: number) => {
  if (value.length <= maxWidth) return value
  if (maxWidth <= 1) return value.slice(0, maxWidth)
  return `${value.slice(0, maxWidth - 1)}…`
}

const renderStatusLine = (status: CliFooterStatus, width: number) =>
  truncate(
    [
      `provider ${status.provider}`,
      `model ${status.model}`,
      `tasks ${status.taskState}`,
      `active ${status.activeTasks}`,
      ...(status.cost ? [`cost ${status.cost}${status.costIncomplete ? '*' : ''}`] : []),
      ...(status.cachePercent === undefined || status.cachePercent === null
        ? []
        : [`cache ${Math.round(status.cachePercent)}%`]),
      `log ${visibleName(status.logPath)}`,
      `conversation ${visibleName(status.conversationPath)}`,
    ].join(' | '),
    Math.max(1, width - 1),
  )

const setScrollRegion = (bottom: number) => {
  process.stdout.write(`\x1b[1;${bottom}r`)
}

const resetScrollRegion = () => {
  process.stdout.write('\x1b[r')
}

const writeFooterText = (text: string) => {
  process.stdout.write(`\x1b[48;5;24m\x1b[38;5;231m ${text} \x1b[0m`)
}

export async function createTerminalKitFooter(environmentPrefix: string): Promise<CliFooter> {
  if (!isSupportedTerminal(environmentPrefix)) return noopCliFooter()

  let terminalKit: typeof TerminalKitModule
  try {
    terminalKit = await import('terminal-kit')
  } catch {
    return noopCliFooter()
  }

  const term = terminalKit.default.terminal
  let lastStatus: CliFooterStatus | undefined
  let active = false

  const render = () => {
    if (!lastStatus || !isSupportedTerminal(environmentPrefix)) return
    const rows = process.stdout.rows
    const cols = process.stdout.columns ?? term.width
    if (!rows || rows < 5) return

    active = true
    setScrollRegion(rows - 1)
    process.stdout.write('\x1b7')
    term.moveTo(1, rows)
    term.eraseLine()
    writeFooterText(renderStatusLine(lastStatus, cols))
    term.styleReset()
    process.stdout.write('\x1b8')
  }

  return {
    beforePrompt: render,
    setStatus: (status) => {
      lastStatus = status
      render()
    },
    restore: () => {
      if (!active) return
      process.stdout.write('\x1b7')
      term.moveTo(1, process.stdout.rows || term.height)
      term.eraseLine()
      term.styleReset()
      process.stdout.write('\x1b8')
      resetScrollRegion()
      active = false
    },
  }
}
