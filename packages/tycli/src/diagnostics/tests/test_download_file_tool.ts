import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadFileTool } from '../../tools/downloadFileTool'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const withTempCwd = async <T>(prefix: string, fn: (dir: string) => Promise<T>) => {
  const previousCwd = process.cwd()
  const dir = join(tmpdir(), `${prefix}-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  try {
    process.chdir(dir)
    return await fn(dir)
  } finally {
    process.chdir(previousCwd)
  }
}

const withMockFetch = async <T>(fetchImpl: typeof fetch, fn: () => Promise<T>) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

export const testDownloadFileReturnsRecoverableFailureForHttpErrors = async () =>
  await withTempCwd(
    'tycli-download-file-http-error',
    async () =>
      await withMockFetch(
        () => Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' })),
        async () => {
          const result = await downloadFileTool.function?.({
            url: 'https://example.test/missing.pdf',
            filePath: 'downloads/missing.pdf',
            expectedFileType: 'pdf',
          })

          assert(
            result &&
              typeof result === 'object' &&
              'ok' in result &&
              result.ok === false &&
              'error' in result &&
              typeof result.error === 'string' &&
              result.error.includes('HTTP 404'),
            `Expected recoverable HTTP failure result, got ${JSON.stringify(result)}`,
          )

          return { success: true }
        },
      ),
  )

export const testDownloadFileReturnsRecoverableFailureForNonPdfBytes = async () =>
  await withTempCwd(
    'tycli-download-file-html-error',
    async () =>
      await withMockFetch(
        () =>
          Promise.resolve(
            new Response('<html>blocked</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          ),
        async () => {
          const result = await downloadFileTool.function?.({
            url: 'https://example.test/wrapper.pdf',
            filePath: 'downloads/wrapper.pdf',
            expectedFileType: 'pdf',
          })

          assert(
            result &&
              typeof result === 'object' &&
              'ok' in result &&
              result.ok === false &&
              'error' in result &&
              typeof result.error === 'string' &&
              result.error.includes('did not return PDF bytes'),
            `Expected recoverable PDF validation failure result, got ${JSON.stringify(result)}`,
          )

          return { success: true }
        },
      ),
  )

export const testDownloadFileRejectsPathsOutsideArtifactRoot = async () =>
  await withTempCwd('tycli-download-file-artifact-root', async () => {
    const result = await downloadFileTool.function?.({
      url: 'https://example.test/result.pdf',
      filePath: 'task_artifacts/result.pdf',
      artifactRoot: 'research/home-battery-specs',
      expectedFileType: 'pdf',
    })

    assert(
      result &&
        typeof result === 'object' &&
        'ok' in result &&
        result.ok === false &&
        'error' in result &&
        typeof result.error === 'string' &&
        result.error.includes('inside artifactRoot research/home-battery-specs/'),
      `Expected artifact-root validation failure, got ${JSON.stringify(result)}`,
    )

    return { success: true }
  })

export const testDownloadFileReturnsRecoverableFailureForMaxBytes = async () =>
  await withTempCwd(
    'tycli-download-file-max-bytes',
    async () =>
      await withMockFetch(
        () =>
          Promise.resolve(
            new Response('large page body', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
          ),
        async () => {
          const result = await downloadFileTool.function?.({
            url: 'https://example.test/page.html',
            filePath: 'research/page.html',
            maxBytes: 4,
          })

          assert(
            result &&
              typeof result === 'object' &&
              'ok' in result &&
              result.ok === false &&
              'error' in result &&
              typeof result.error === 'string' &&
              result.error.includes('exceeding maxBytes 4'),
            `Expected recoverable maxBytes failure result, got ${JSON.stringify(result)}`,
          )

          return { success: true }
        },
      ),
  )

testDownloadFileReturnsRecoverableFailureForHttpErrors.description =
  'downloadFile returns ok=false instead of throwing for HTTP download failures.'
testDownloadFileReturnsRecoverableFailureForNonPdfBytes.description =
  'downloadFile returns ok=false instead of throwing when a requested PDF URL returns HTML.'
testDownloadFileRejectsPathsOutsideArtifactRoot.description =
  'downloadFile rejects research downloads that try to write outside the selected artifact root.'
testDownloadFileReturnsRecoverableFailureForMaxBytes.description =
  'downloadFile returns ok=false when a raw download exceeds the requested maxBytes limit.'
