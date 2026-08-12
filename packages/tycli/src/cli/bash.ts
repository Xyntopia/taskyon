import type { ToolProgress } from '@taskyon/taskyon'
import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'

export type BashCommandInput = {
  command: string
  cwd: string
  timeoutMs: number
}

export type BashCommandResult = {
  command: string
  cwd: string
  exitCode: number | null
  ok: boolean
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
}

const MAX_ERROR_TAIL_CHARS = 4_000
const MAX_PROGRESS_CHARS = 4_000

const appendTail = (tail: string, chunk: string) => `${tail}${chunk}`.slice(-MAX_ERROR_TAIL_CHARS)

const formatTerminationError = (
  kind: 'cancelled' | 'timed out',
  elapsedMs: number,
  reason: string,
  stdoutTail: string,
  stderrTail: string,
) => {
  const details = [
    `bash command ${kind} after ${elapsedMs}ms: ${reason}`,
    stdoutTail ? `stdout tail:\n${stdoutTail}` : '',
    stderrTail ? `stderr tail:\n${stderrTail}` : '',
  ].filter(Boolean)
  return new Error(details.join('\n'))
}

const terminateProcess = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // Fall back to the immediate child when its process group is already gone.
    }
  }
  child.kill(signal)
}

const runWithShell = async (
  shell: string,
  input: BashCommandInput,
  runtime: {
    stopSignal: AbortSignal
    reportProgress: (progress: ToolProgress) => Promise<void>
  },
) =>
  await new Promise<BashCommandResult>((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(shell, ['-c', input.command], {
      cwd: input.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutTail = ''
    let stderrTail = ''
    let settled = false
    let termination: { kind: 'cancelled' | 'timed out'; reason: string } | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let progressQueue = Promise.resolve()

    const report = (kind: ToolProgress['kind'], message: string) => {
      progressQueue = progressQueue
        .then(async () =>
          runtime.reportProgress({ kind, message: message.slice(-MAX_PROGRESS_CHARS) }),
        )
        .catch(() => undefined)
    }

    const onAbort = () => terminate('cancelled', String(runtime.stopSignal.reason ?? 'aborted'))

    const cleanup = () => {
      clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      runtime.stopSignal.removeEventListener('abort', onAbort)
    }

    const finish = (result: { value: BashCommandResult } | { error: Error }) => {
      if (settled) return
      settled = true
      cleanup()
      void progressQueue.finally(() => {
        if ('value' in result) resolve(result.value)
        else reject(result.error)
      })
    }

    const terminate = (kind: 'cancelled' | 'timed out', reason: string) => {
      if (termination || settled) return
      termination = { kind, reason }
      terminateProcess(child, 'SIGTERM')
      forceKillTimer = setTimeout(() => terminateProcess(child, 'SIGKILL'), 1_000)
      forceKillTimer.unref()
    }

    runtime.stopSignal.addEventListener('abort', onAbort, { once: true })
    const timeoutTimer = setTimeout(
      () => terminate('timed out', `${input.timeoutMs}ms timeout reached`),
      input.timeoutMs,
    )

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stdout += text
      stdoutTail = appendTail(stdoutTail, text)
      report('stdout', text)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stderr += text
      stderrTail = appendTail(stderrTail, text)
      report('stderr', text)
    })
    child.on('error', (error) => finish({ error }))
    child.on('close', (exitCode, signal) => {
      if (termination) {
        finish({
          error: formatTerminationError(
            termination.kind,
            Date.now() - startedAt,
            termination.reason,
            stdoutTail,
            stderrTail,
          ),
        })
        return
      }
      finish({
        value: {
          command: input.command,
          cwd: input.cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          ok: exitCode === 0,
        },
      })
    })

    if (runtime.stopSignal.aborted) onAbort()
  })

export async function runBashCommand(
  input: BashCommandInput,
  runtime: {
    stopSignal: AbortSignal
    reportProgress: (progress: ToolProgress) => Promise<void>
  },
) {
  const shellCandidates = Array.from(
    new Set([process.env.SHELL, 'bash', 'sh'].filter((value): value is string => Boolean(value))),
  )
  let lastError: Error | undefined

  for (const shell of shellCandidates) {
    try {
      return await runWithShell(shell, input, runtime)
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(String(error))
      lastError = asError
      if (!asError.message.includes('ENOENT')) throw asError
    }
  }

  throw lastError ?? new Error('No usable shell found for bash tool execution')
}
