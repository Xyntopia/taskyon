import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTool } from '@taskyon/taskyon/api'
import { assertPathInsideArtifactRoot, resolveWorkspacePath } from './workspacePaths'

type DownloadFileArgs = {
  url?: string
  filePath?: string
  artifactRoot?: string
  expectedFileType?: 'pdf'
  maxBytes?: number
  timeoutMs?: number
}

const looksLikePdf = (bytes: Uint8Array) =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d

const shouldValidatePdf = (args: DownloadFileArgs) =>
  args.expectedFileType === 'pdf' || args.filePath?.toLowerCase().endsWith('.pdf') === true

const recoverableDownloadFailure = (filePath: string, url: string, error: unknown) => ({
  ok: false,
  filePath,
  url,
  error: error instanceof Error ? error.message : String(error),
})

export const downloadFileTool = createTool({
  name: 'downloadFile',
  description:
    'Download an accessible URL to a workspace file and verify the saved bytes match the expected file type.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'filePath'],
    properties: {
      url: {
        type: 'string',
        description: 'Absolute URL to download.',
      },
      filePath: {
        type: 'string',
        description:
          'Relative workspace path to write. Use a task-specific directory and stable filename.',
      },
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative directory that all research artifacts for this request must stay under, for example research/solar-cell-spec-sheets/.',
      },
      expectedFileType: {
        type: 'string',
        enum: ['pdf'],
        description:
          'Optional expected file type. When set to pdf, the tool rejects HTML/error pages and only saves real PDF bytes.',
      },
      maxBytes: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional byte limit. Use this for raw HTML/text/page downloads when a normalized summary or manifest is enough; omit it for expected large PDFs or datasets.',
      },
      timeoutMs: {
        type: 'integer',
        default: 120000,
        description: 'Download timeout in milliseconds.',
      },
    },
  } as const,
  function: async (args: DownloadFileArgs) => {
    const url = args.url?.trim()
    const filePath = args.filePath?.trim()
    if (!url) throw new Error('downloadFile requires a non-empty url.')
    if (!filePath) throw new Error('downloadFile requires a non-empty filePath.')

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort('downloadFile timed out'),
      args.timeoutMs ?? 120000,
    )
    try {
      try {
        assertPathInsideArtifactRoot(filePath, args.artifactRoot)
        const fullPath = resolveWorkspacePath(filePath)
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
            'user-agent': 'Taskyon tycli downloadFile/0.1',
          },
        })
        if (!response.ok) {
          throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0) throw new Error('Download returned an empty response.')
        if (args.maxBytes !== undefined && bytes.length > args.maxBytes) {
          throw new Error(
            `Download returned ${bytes.length} bytes, exceeding maxBytes ${args.maxBytes}.`,
          )
        }
        if (shouldValidatePdf(args) && !looksLikePdf(bytes)) {
          throw new Error(
            `Download did not return PDF bytes. Content-Type was ${contentType}; first bytes were ${Array.from(
              bytes.slice(0, 12),
            )
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(' ')}.`,
          )
        }

        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, bytes)

        return {
          ok: true,
          filePath,
          size: bytes.length,
          contentType,
        }
      } catch (error) {
        return recoverableDownloadFailure(filePath, url, error)
      }
    } finally {
      clearTimeout(timeout)
    }
  },
})
