import { isTauri } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'

type LogMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

declare global {
  interface Window {
    __taskyonTauriStdoutBridge?: {
      installed: boolean
      originals: Record<LogMethod, (...args: unknown[]) => void>
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

export function enableTauriStdoutBridge(): boolean {
  if (!isTauri()) return false

  const search = new URLSearchParams(window.location.search)
  const forceStdout = search.get('stdout') === '1'
  if (!forceStdout) return false

  const methods: LogMethod[] = ['log', 'info', 'warn', 'error', 'debug']
  const existing = window.__taskyonTauriStdoutBridge
  if (existing?.installed) return true

  const originals =
    existing?.originals ??
    methods.reduce(
      (acc, method) => {
        acc[method] = console[method].bind(console)
        return acc
      },
      {} as Record<LogMethod, (...args: unknown[]) => void>,
    )

  window.__taskyonTauriStdoutBridge = {
    installed: true,
    originals,
  }

  for (const level of methods) {
    const original = originals[level]
    console[level] = (...args: unknown[]) => {
      // Forward to Rust/stdout via Tauri events; keep original console behavior.
      void emit('headless-console', {
        level,
        message: args.map(formatArg).join(' '),
      })
      original(...args)
    }
  }

  return true
}
