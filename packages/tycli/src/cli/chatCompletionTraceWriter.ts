import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatCompletionTraceRecord } from '@taskyon/taskyon/tools/chatCompletionTrace'

const sanitizeTraceFilePart = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'trace'

const createJsonReplacer = () => {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value === 'bigint') return value.toString()
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

export function createCliChatCompletionTraceWriter(
  traceDir: string,
  defaultLabel?: string,
  captureResponse = false,
) {
  let sequence = 0
  return {
    captureResponse,
    write: async (record: ChatCompletionTraceRecord) => {
      const { providerResponse, ...requestRecord } = record
      const savedRecord = {
        ...requestRecord,
        label: record.label ?? defaultLabel,
        ...(captureResponse && providerResponse ? { providerResponse } : {}),
      }
      await mkdir(traceDir, { recursive: true, mode: 0o700 })
      for (;;) {
        const sequenceId = ++sequence
        const fileName = [
          String(sequenceId).padStart(4, '0'),
          ...(savedRecord.label ? [sanitizeTraceFilePart(savedRecord.label)] : []),
          sanitizeTraceFilePart(savedRecord.taskId),
          'record',
        ].join('_')
        try {
          await writeFile(
            join(traceDir, `${fileName}.json`),
            JSON.stringify({ sequence: sequenceId, ...savedRecord }, createJsonReplacer(), 2),
            { encoding: 'utf8', flag: 'wx', mode: 0o600 },
          )
          return
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error)) throw error
          if (error.code !== 'EEXIST') throw error
        }
      }
    },
  }
}
