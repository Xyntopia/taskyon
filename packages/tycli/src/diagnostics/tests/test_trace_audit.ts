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
        recordedAt: '2026-08-09T12:00:00.000Z',
        usage: {
          inputTokens: { total: 1400, noCache: 300, cacheRead: 1000, cacheWrite: 100 },
          outputTokens: { total: 80, text: 60, reasoning: 20 },
          totalTokens: 1480,
        },
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
  await writeFile(
    join(traceDir, '0002_diagnostic_router_record.json'),
    JSON.stringify({
      sequence: 2,
      taskId: 'router',
      label: 'diagnostic-router',
      providerRequest: {
        provider: 'chatgpt-codex',
        model: 'gpt-5.6-sol',
        taskId: 'router',
        recordedAt: '2026-08-09T12:00:01.000Z',
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
          totalTokens: 920,
        },
        attempts: [
          {
            method: 'POST',
            url: 'https://example.invalid/responses',
            requestHeaders: { 'content-type': 'application/json' },
            requestBody: {
              model: 'gpt-5.6-sol',
              instructions: 'Stable instructions',
              prompt_cache_key: 'stable-key',
              tools: [{ type: 'function', name: 'entryNode' }],
              input: [
                { role: 'user', content: 'different router suffix' },
                { role: 'developer', content: 'Runtime reference: first request' },
              ],
            },
            response: { status: 200, headers: {} },
          },
        ],
      },
    }),
    'utf8',
  )
  await writeFile(
    join(traceDir, '0003_diagnostic_router_record.json'),
    JSON.stringify({
      sequence: 3,
      taskId: 'router',
      label: 'diagnostic-router',
      providerRequest: {
        provider: 'chatgpt-codex',
        model: 'gpt-5.6-sol',
        taskId: 'router',
        recordedAt: '2026-08-09T12:00:02.000Z',
        usage: {
          inputTokens: { total: 1000, noCache: 500, cacheRead: 500, cacheWrite: 0 },
          outputTokens: { total: 30, text: 30, reasoning: 0 },
          totalTokens: 1030,
        },
        attempts: [
          {
            method: 'POST',
            url: 'https://example.invalid/responses',
            requestHeaders: { 'content-type': 'application/json' },
            requestBody: {
              model: 'gpt-5.6-sol',
              instructions: 'Changed instructions',
              prompt_cache_key: 'stable-key',
              tools: [{ type: 'function', name: 'entryNode' }],
              input: [
                { role: 'user', content: 'different router suffix' },
                { role: 'assistant', content: 'The conversation has grown.' },
                { role: 'developer', content: 'Runtime reference: second request' },
              ],
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
    totals?: {
      chatCompletions?: number
      completedChatCompletions?: number
      usageAvailableChatCompletions?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      noCacheTokens?: number
    }
    stability?: { requestPromptCacheKeys?: string[]; requestFamilies?: unknown[] }
    warnings?: string[]
  }
  assert(report.totals?.chatCompletions === 3, 'Expected every record file to count as a call')
  assert(report.totals?.completedChatCompletions === 3, 'Expected every HTTP response to count')
  assert(
    report.stability?.requestPromptCacheKeys?.[0] === 'stable-key',
    'Expected the wire-format prompt cache key to be audited',
  )
  assert(report.totals?.usageAvailableChatCompletions === 3, 'Expected usage availability')
  assert(report.totals?.cacheReadTokens === 1500, 'Expected cached input tokens from the trace')
  assert(report.totals?.cacheWriteTokens === 100, 'Expected cache-write tokens from the trace')
  assert(report.totals?.noCacheTokens === 1700, 'Expected ordinary input tokens from the trace')
  assert(
    report.stability?.requestFamilies?.length === 2,
    'Expected router and executor tool shapes to be separate request families',
  )
  assert(
    !report.warnings?.some((warning) => warning.includes('first two messages')),
    'Expected growing conversations and changing runtime suffixes not to look like prefix drift',
  )
  assert(
    report.warnings?.some((warning) => warning.includes('Provider instructions')),
    'Expected genuine provider-instruction drift within one family to be reported',
  )
}

testTraceAuditReadsProviderRequestRecordFiles.description =
  'Audits the current single-record tycli chatCompletion trace format.'
