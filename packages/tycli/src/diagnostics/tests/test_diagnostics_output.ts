import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDiagnosticsOutput,
  formatFailedDiagnostics,
  type DiagnosticsWritable,
} from '../diagnosticsOutput'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const createWritable = () => {
  const chunks: string[] = []
  const writable = {
    write: ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as DiagnosticsWritable['write'],
  }
  return { chunks, writable }
}

export const testDiagnosticsOutputKeepsNormalConsoleConciseAndLogsLiveOutput = async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'tycli-diagnostics-output-'))
  const stdout = createWritable()
  const stderr = createWritable()
  const output = createDiagnosticsOutput({
    logDir,
    verbose: false,
    startedAt: new Date('2026-08-02T12:34:56.000Z'),
    pid: 42,
    stdout: stdout.writable,
    stderr: stderr.writable,
  })
  const restore = output.capture()

  stdout.writable.write('noisy test output\n')
  output.status('[PASS] Example diagnostic')
  restore()

  const log = await readFile(output.logFile, 'utf8')
  assert(log.includes('noisy test output'), 'Expected noisy output to be appended to the log')
  assert(
    log.includes('[PASS] Example diagnostic'),
    'Expected test status to be appended to the log',
  )
  assert(
    stdout.chunks.join('') === '[PASS] Example diagnostic\n',
    'Expected normal console output to contain only the status line',
  )
}

testDiagnosticsOutputKeepsNormalConsoleConciseAndLogsLiveOutput.description =
  'Keeps normal diagnostics output concise while synchronously preserving test output in a log.'

export const testDiagnosticsOutputVerboseModeAndFailureSummary = async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'tycli-diagnostics-output-'))
  const stdout = createWritable()
  const stderr = createWritable()
  const output = createDiagnosticsOutput({
    logDir,
    verbose: true,
    startedAt: new Date('2026-08-02T12:34:56.000Z'),
    pid: 43,
    stdout: stdout.writable,
    stderr: stderr.writable,
  })
  const restore = output.capture()

  stdout.writable.write('legacy verbose output\n')
  restore()

  assert(stdout.chunks.join('') === 'legacy verbose output\n', 'Expected verbose output on stdout')
  assert(
    formatFailedDiagnostics([
      {
        name: 'Broken deterministic diagnostic',
        ok: false,
        modelBased: false,
        error: { message: 'expected value was missing' },
      },
      { name: 'Model capability miss', ok: false, modelBased: true },
    ]) === 'Failed tests:\n- Broken deterministic diagnostic',
    'Expected the failure summary to name deterministic failures and exclude model misses',
  )
}

testDiagnosticsOutputVerboseModeAndFailureSummary.description =
  'Restores verbose console output and explicitly names deterministic failures in the summary.'
