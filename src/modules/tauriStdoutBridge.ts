import { isTauri } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'

type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type TauriStdoutMessage = { level: LogMethod; message: string }

declare global {
  interface Window {
    __taskyonTauriStdoutBridge?: {
      installed: boolean
    }
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack || arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export function createTauriStdoutForwarder(
  level: LogMethod,
  send: (message: TauriStdoutMessage) => void,
) {
  return (...args: unknown[]) => {
    send({ level, message: args.map(formatArg).join(' ') })
  }
}

export function enableTauriStdoutBridge(): boolean {
  if (!isTauri()) return false

  const search = new URLSearchParams(window.location.search)
  const forceStdout = search.get('stdout') === '1'
  if (!forceStdout) return false

  const methods: LogMethod[] = ['log', 'info', 'warn', 'error', 'debug']
  const existing = window.__taskyonTauriStdoutBridge
  if (existing?.installed) return true

  window.__taskyonTauriStdoutBridge = { installed: true }

  for (const level of methods) {
    console[level] = createTauriStdoutForwarder(level, (message) => {
      void emit('headless-console', message)
    })
  }

  return true
}
