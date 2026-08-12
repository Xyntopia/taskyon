import { runBashCommand } from '../../cli/bash'
import type { ToolProgress } from '@taskyon/taskyon'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testCliBashStreamsOutputBeforeCompletion = async () => {
  const progress: ToolProgress[] = []
  const result = await runBashCommand(
    {
      command: "printf 'first\\n'; sleep 0.05; printf 'second\\n'",
      cwd: process.cwd(),
      timeoutMs: 2_000,
    },
    {
      stopSignal: new AbortController().signal,
      reportProgress: (event) => {
        progress.push(event)
        return Promise.resolve()
      },
    },
  )

  assert(result.ok, 'Expected Bash command to succeed')
  assert(result.stdout === 'first\nsecond\n', `Unexpected stdout: ${result.stdout}`)
  const streamedStdout = progress
    .filter((event) => event.kind === 'stdout')
    .map((event) => event.message)
    .join('')
  assert(
    streamedStdout === result.stdout,
    `Expected streamed stdout to match the result, got: ${streamedStdout}`,
  )
}

testCliBashStreamsOutputBeforeCompletion.description =
  'Streams Bash stdout through generic tool progress before returning the final result.'

export const testCliBashUsesNonLoginShell = async () => {
  const result = await runBashCommand(
    {
      command:
        'if [ -n "$BASH_VERSION" ] && shopt -q login_shell; then exit 42; fi; printf non-login',
      cwd: process.cwd(),
      timeoutMs: 2_000,
    },
    {
      stopSignal: new AbortController().signal,
      reportProgress: () => Promise.resolve(),
    },
  )

  assert(result.ok, `Expected a non-login shell, got exit code ${String(result.exitCode)}`)
  assert(result.stdout === 'non-login', `Unexpected stdout: ${result.stdout}`)
}

testCliBashUsesNonLoginShell.description =
  'Runs Bash commands without loading login profiles while preserving the inherited environment.'

export const testCliBashCancellationIncludesOutputContext = async () => {
  const controller = new AbortController()
  const promise = runBashCommand(
    {
      command: "printf 'started\\n'; sleep 10",
      cwd: process.cwd(),
      timeoutMs: 20_000,
    },
    {
      stopSignal: controller.signal,
      reportProgress: () => Promise.resolve(),
    },
  )
  setTimeout(() => controller.abort('diagnostic cancellation'), 50)

  try {
    await promise
    throw new Error('Expected Bash command to be cancelled')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(message.includes('cancelled'), `Expected cancellation detail, got: ${message}`)
    assert(message.includes('started'), `Expected stdout tail, got: ${message}`)
    assert(message.includes('diagnostic cancellation'), `Expected cancellation reason: ${message}`)
  }
}

testCliBashCancellationIncludesOutputContext.description =
  'Terminates Bash on worker cancellation and includes bounded output context in the error.'

export const testCliBashTimeoutIncludesOutputContext = async () => {
  try {
    await runBashCommand(
      {
        command: "printf 'before-timeout\\n'; sleep 10",
        cwd: process.cwd(),
        timeoutMs: 50,
      },
      {
        stopSignal: new AbortController().signal,
        reportProgress: () => Promise.resolve(),
      },
    )
    throw new Error('Expected Bash command to time out')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(message.includes('timed out'), `Expected timeout detail, got: ${message}`)
    assert(message.includes('before-timeout'), `Expected stdout tail, got: ${message}`)
    assert(message.includes('50ms'), `Expected timeout duration, got: ${message}`)
  }
}

testCliBashTimeoutIncludesOutputContext.description =
  'Terminates Bash at its tool-owned timeout and includes bounded output context in the error.'
