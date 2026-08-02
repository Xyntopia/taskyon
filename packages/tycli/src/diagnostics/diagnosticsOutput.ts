import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DiagnosticsRunResult } from '@taskyon/common/modules/diagnosticsRunner'

export type DiagnosticsWritable = Pick<NodeJS.WriteStream, 'write'>

type WriteCallback = (error?: Error | null) => void
type WritableWrite = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | WriteCallback,
  callback?: WriteCallback,
) => boolean

const safeTimestamp = (date: Date) => date.toISOString().replace(/[:.]/g, '-')

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return errorMessage(error.message)
  }
  return String(error)
}

const chunkText = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | WriteCallback,
) =>
  typeof chunk === 'string'
    ? chunk
    : Buffer.from(chunk).toString(
        typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8',
      )

export const formatFailedDiagnostics = (results: DiagnosticsRunResult[]): string => {
  const failures = results.filter((result) => !result.ok && !result.modelBased)
  if (failures.length === 0) return 'Failed tests: none'
  return ['Failed tests:', ...failures.map((failure) => `- ${failure.name}`)].join('\n')
}

export const createDiagnosticsOutput = (args: {
  logDir: string
  verbose: boolean
  startedAt?: Date
  pid?: number
  stdout?: DiagnosticsWritable
  stderr?: DiagnosticsWritable
}) => {
  const startedAt = args.startedAt ?? new Date()
  const pid = args.pid ?? process.pid
  const stdout = args.stdout ?? process.stdout
  const stderr = args.stderr ?? process.stderr
  const originalStdout = stdout.write.bind(stdout) as WritableWrite
  const originalStderr = stderr.write.bind(stderr) as WritableWrite
  mkdirSync(args.logDir, { recursive: true })
  const logFile = join(args.logDir, `diagnostics_${safeTimestamp(startedAt)}_${pid}.log`)
  writeFileSync(
    logFile,
    [`timestamp=${startedAt.toISOString()}`, `cwd=${process.cwd()}`, `pid=${pid}`, ''].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  )

  let reportedLogError = false
  const append = (source: string, text: string) => {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] [${source}] ${text}`, 'utf8')
    } catch (error) {
      if (reportedLogError) return
      reportedLogError = true
      originalStderr(`[tycli-diagnostics] log write failed: ${errorMessage(error)}\n`)
    }
  }

  const write = (source: 'stdout' | 'stderr', text: string, visible: boolean) => {
    const line = text.endsWith('\n') ? text : `${text}\n`
    append(source, line)
    if (visible) (source === 'stderr' ? originalStderr : originalStdout)(line)
  }

  const captureStream = (
    stream: DiagnosticsWritable,
    source: 'stdout' | 'stderr',
    originalWrite: WritableWrite,
  ) => {
    stream.write = ((
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ) => {
      append(source, chunkText(chunk, encodingOrCallback))
      if (args.verbose) return originalWrite(chunk, encodingOrCallback, callback)
      const completed = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      if (completed) queueMicrotask(() => completed())
      return true
    }) as DiagnosticsWritable['write']
  }

  return {
    logFile,
    status: (text: string, source: 'stdout' | 'stderr' = 'stdout') => write(source, text, true),
    detail: (text: string, source: 'stdout' | 'stderr' = 'stdout') =>
      write(source, text, args.verbose),
    log: append,
    capture: () => {
      captureStream(stdout, 'stdout', originalStdout)
      captureStream(stderr, 'stderr', originalStderr)
      let restored = false
      return () => {
        if (restored) return
        restored = true
        stdout.write = originalStdout as DiagnosticsWritable['write']
        stderr.write = originalStderr as DiagnosticsWritable['write']
      }
    },
  }
}
