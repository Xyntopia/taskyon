import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testTraceAuditReadsProviderRequestRecordFiles = async () => {
  const traceDir = await mkdtemp(join(tmpdir(), 'tycli-trace-audit-diagnostic-'))
  await writeFile(
    join(traceDir, '0001_diagnostic_task_record.json'),
    JSON.stringify({
      sequence: 1,
      taskId: 'task',
      label: 'diagnostic',
      providerRequest: {
        provider: 'chatgpt-codex',
        model: 'gpt-5.6-sol',
        taskId: 'task',
        attempts: [
          {
            method: 'POST',
            url: 'https://example.invalid/responses',
            requestHeaders: { 'content-type': 'application/json' },
            requestBody: {
              model: 'gpt-5.6-sol',
              instructions: 'Stable instructions',
              prompt_cache_key: 'stable-key',
              input: [{ role: 'user', content: 'hello' }],
            },
            response: { status: 200, headers: {} },
          },
        ],
      },
    }),
    'utf8',
  )

  const auditScript = new URL(
    '../../../../../scripts/audit-tycli-chatcompletion-trace.mjs',
    import.meta.url,
  )
  const originalArgv = process.argv
  const originalConsoleLog = console.log
  let stdout = ''
  try {
    process.argv = [process.execPath, auditScript.pathname, traceDir, '--json']
    console.log = (...values: unknown[]) => {
      stdout += `${values.map(String).join(' ')}\n`
    }
    await import(`${auditScript.href}?diagnostic=${Date.now()}`)
  } finally {
    console.log = originalConsoleLog
    process.argv = originalArgv
  }
  assert(stdout.trim().length > 0, 'Expected the trace auditor to emit a JSON report')
  const report = JSON.parse(stdout) as {
    totals?: { chatCompletions?: number; completedChatCompletions?: number }
    stability?: { requestPromptCacheKeys?: string[] }
  }
  assert(report.totals?.chatCompletions === 1, 'Expected the record file to count as one call')
  assert(report.totals?.completedChatCompletions === 1, 'Expected the HTTP response to be counted')
  assert(
    report.stability?.requestPromptCacheKeys?.[0] === 'stable-key',
    'Expected the wire-format prompt cache key to be audited',
  )
}

testTraceAuditReadsProviderRequestRecordFiles.description =
  'Audits the current single-record tycli chatCompletion trace format.'
