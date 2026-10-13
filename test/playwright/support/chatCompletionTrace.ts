import type { Page, Request } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  redactChatCompletionTraceValue,
  type ChatCompletionTraceRecord,
} from '../../../packages/taskyon/src/tools/chatCompletionTrace'
import { createCliChatCompletionTraceWriter } from '../../../packages/tycli/src/cli/chatCompletionTraceWriter'

export const captureBrowserChatCompletionTrace = async (page: Page) => {
  const dir = process.env.PLAYWRIGHT_CHAT_COMPLETION_TRACE_DIR
  if (!dir) return undefined
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const writer = createCliChatCompletionTraceWriter(dir, 'browser-wire', true)
  const records = new Map<Request, ChatCompletionTraceRecord>()
  const pending: Promise<void>[] = []
  const consoleMessages: unknown[] = []
  let sequence = 0
  page.on('console', (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() })
  })
  page.on('pageerror', (error) => {
    consoleMessages.push({ type: 'pageerror', text: error.message })
  })
  page.on('request', (request) => {
    if (!/\/chat\/completions(?:\?|$)/.test(request.url()) || request.method() !== 'POST') return
    const body: unknown = request.postDataJSON()
    const model = body && typeof body === 'object' && 'model' in body ? body.model : undefined
    const taskId = `browser-wire-${++sequence}`
    records.set(request, {
      taskId,
      providerRequest: {
        taskId,
        provider: process.env.PLAYWRIGHT_RESEARCH_PROVIDER ?? 'openrouter.ai',
        model: typeof model === 'string' ? model : '(unavailable)',
        recordedAt: new Date().toISOString(),
        attempts: [
          {
            method: request.method(),
            url: request.url(),
            requestHeaders: {},
            requestBody: redactChatCompletionTraceValue(body),
          },
        ],
      },
    })
  })
  page.on('requestfinished', (request) => {
    const record = records.get(request)
    if (!record) return
    pending.push(
      (async () => {
        const response = await request.response()
        if (response) {
          const attempt = record.providerRequest.attempts[0]!
          attempt.response = {
            status: response.status(),
            headers: { 'content-type': response.headers()['content-type'] ?? '' },
          }
          const text = await response.text()
          const rawChunks = text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => {
              const data = line.slice(5).trim()
              try {
                return redactChatCompletionTraceValue(JSON.parse(data))
              } catch {
                return redactChatCompletionTraceValue(data)
              }
            })
          record.providerResponse = {
            rawChunks: rawChunks.length ? rawChunks : [redactChatCompletionTraceValue(text)],
          }
        }
        await writer.write(record)
      })(),
    )
  })
  page.on('requestfailed', (request) => {
    const record = records.get(request)
    if (!record) return
    record.providerRequest.attempts[0]!.error = {
      message: request.failure()?.errorText ?? 'Request failed',
    }
    pending.push(writer.write(record))
  })
  return {
    saveRuntimeConfig: async () => {
      const profile = await page.evaluate(() => {
        const decode = (value: string | null) =>
          value?.startsWith('__q_strn|') ? value.slice('__q_strn|'.length) : value
        const name = decode(localStorage.getItem('currentProfile'))
        if (!name) throw new Error('Active browser profile is unavailable')
        const raw = decode(localStorage.getItem(`uiProfile:${name}`))
        if (!raw) throw new Error('Stored browser profile is unavailable')
        const parsed = JSON.parse(raw)
        return {
          llmSettings: parsed.llmSettings,
          toolchainProfiles: parsed.toolchainProfiles,
          selectedToolchainProfile: parsed.selectedToolchainProfile,
        }
      })
      await writeFile(join(dir, 'runtime-config.json'), JSON.stringify(profile, null, 2), {
        mode: 0o600,
      })
    },
    finish: async () => {
      await Promise.all(pending)
      const diagnostics = await page
        .locator('[data-cy="diagnostics-result"]')
        .textContent()
        .catch(() => null)
      await writeFile(
        join(dir, 'browser-log.json'),
        JSON.stringify(redactChatCompletionTraceValue({ consoleMessages, diagnostics }), null, 2),
        { mode: 0o600 },
      )
    },
  }
}
