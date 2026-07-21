import process from 'node:process'
import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  buildDiagnosticsRegistry,
  runDiagnosticsTests,
} from '@taskyon/common/modules/diagnosticsRunner'
import * as cliE2eDiagnostics from './cliE2eDiagnostics'
import * as cliModelDiagnostics from './cliModelDiagnostics'

function safeTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function formatError(error: unknown) {
  return typeof error === 'string' ? error : JSON.stringify(error, null, 2)
}

async function writeE2eLog(args: {
  startedAt: Date
  results: Awaited<ReturnType<typeof runDiagnosticsTests>>
}) {
  const finishedAt = new Date()
  const sessionLogs = cliE2eDiagnostics.getCliE2eSessionLogs()
  const lines = [
    '# tycli e2e diagnostics',
    '',
    `startedAt: ${args.startedAt.toISOString()}`,
    `finishedAt: ${finishedAt.toISOString()}`,
    `cwd: ${process.cwd()}`,
    `PATH: ${process.env.PATH ?? ''}`,
    '',
    '## Results',
    ...args.results.map((result) => {
      const status = result.ok ? 'PASS' : 'FAIL'
      return `${status} ${result.name}${result.ok ? '' : `\n${formatError(result.error)}`}`
    }),
    '',
    '## Sessions',
    ...sessionLogs.map((log, idx) =>
      [
        `### ${idx + 1}. ${log.testName}`,
        `launcher: ${log.label}`,
        `command: ${log.command} ${log.args.join(' ')}`,
        `exitCode: ${String(log.code)}`,
        '',
        '```',
        log.output,
        '```',
        '',
      ].join('\n'),
    ),
  ]
  const content = `${lines.join('\n')}\n`
  const rootDir = process.cwd()
  const timestampedPath = join(rootDir, `tycli-e2e-${safeTimestamp(args.startedAt)}.log`)
  const latestPath = join(rootDir, 'tycli-e2e-latest.log')
  await writeFile(timestampedPath, content, 'utf8')
  await writeFile(latestPath, content, 'utf8')
  return {
    timestampedPath,
    latestPath,
    timestampedRelative: relative(rootDir, timestampedPath),
    latestRelative: relative(rootDir, latestPath),
  }
}

async function main() {
  const startedAt = new Date()
  cliE2eDiagnostics.clearCliE2eSessionLogs()
  const registry = buildDiagnosticsRegistry({
    modules: [
      { sourcePath: 'packages/tycli/src/tests/cliE2eDiagnostics.ts', mod: cliE2eDiagnostics },
      { sourcePath: 'packages/tycli/src/tests/cliModelDiagnostics.ts', mod: cliModelDiagnostics },
    ],
  })
  const includeExperimental = process.env.TYCLI_E2E_INCLUDE_EXPERIMENTAL === '1'
  const selectedTests = includeExperimental
    ? { ...registry.tests, ...registry.experimentalTests }
    : registry.tests

  const results = await runDiagnosticsTests(selectedTests, {
    timeoutMs: 40_000,
    onProgress: ({ phase, test, ok }) => {
      if (phase === 'start') process.stdout.write(`RUN  ${test}\n`)
      else process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${test}\n`)
    },
  })

  const logPaths = await writeE2eLog({ startedAt, results })
  process.stdout.write(`Log written: ${logPaths.latestRelative}\n`)

  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    process.stderr.write(`\n${failed.length} test(s) failed:\n`)
    for (const failure of failed) {
      process.stderr.write(`- ${failure.name}: ${JSON.stringify(failure.error)}\n`)
    }
    process.exitCode = 1
    return
  }

  process.stdout.write(`\nAll ${results.length} CLI diagnostics passed.\n`)
}

void main().catch((error) => {
  process.stderr.write(
    `CLI diagnostics runner failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
