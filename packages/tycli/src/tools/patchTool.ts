import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTool } from '@taskyon/taskyon/api'
import {
  applyFileUpdateToContent,
  getFileUpdateMode,
  normalizeFileUpdate,
  type FileUpdate,
} from '@taskyon/taskyon/tools/filePatching'
import { assertPathInsideArtifactRoot, resolveWorkspacePath } from './workspacePaths'

type UpdateFilesArgs = {
  updates: FileUpdate[]
  artifactRoot?: string
}

const isMissingFileError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

export const updateFilesTool = createTool({
  name: 'updateFiles',
  description:
    'Create or edit workspace files. Each update must use exactly one mode: newContent, patches, or regexReplacements. Use newContent by itself when creating or fully replacing a file.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['updates'],
    properties: {
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative directory that all research artifact files in this update must stay under, for example research/solar-cell-spec-sheets/.',
      },
      updates: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['filePath'],
          oneOf: [
            {
              required: ['newContent'],
              not: {
                anyOf: [{ required: ['patches'] }, { required: ['regexReplacements'] }],
              },
            },
            {
              required: ['patches'],
              not: {
                anyOf: [{ required: ['newContent'] }, { required: ['regexReplacements'] }],
              },
            },
            {
              required: ['regexReplacements'],
              not: {
                anyOf: [{ required: ['newContent'] }, { required: ['patches'] }],
              },
            },
          ],
          properties: {
            filePath: { type: 'string' },
            newContent: {
              type: 'string',
              description:
                'Complete file contents for creating a new file or replacing an existing file. Do not include patches or regexReplacements with this mode.',
            },
            patches: {
              type: 'array',
              minItems: 1,
              description:
                'Search/replace patches for an existing file. Do not include newContent or regexReplacements with this mode.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  search: { type: 'string' },
                  searchStart: { type: 'string' },
                  searchEnd: { type: 'string' },
                  contextLines: { type: 'integer' },
                  replace: { type: 'string' },
                },
              },
            },
            regexReplacements: {
              type: 'array',
              minItems: 1,
              description:
                'Regex replacements for an existing file. Do not include newContent or patches with this mode.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['pattern', 'replace'],
                properties: {
                  pattern: { type: 'string' },
                  replace: { type: 'string' },
                  flags: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  } as const,
  function: async ({ updates, artifactRoot }: UpdateFilesArgs) => {
    const results: Array<{ filePath: string; mode: string; changed: boolean }> = []

    for (const rawUpdate of updates) {
      const update = normalizeFileUpdate(rawUpdate)
      assertPathInsideArtifactRoot(update.filePath, artifactRoot)
      const mode = getFileUpdateMode(update)
      const fullPath = resolveWorkspacePath(update.filePath)
      const current = await readFile(fullPath, 'utf8').catch((error: unknown) => {
        if (mode === 'newContent' && isMissingFileError(error)) return ''
        throw error
      })
      const next = applyFileUpdateToContent(current, update)
      const changed = next !== current
      if (changed) {
        await mkdir(dirname(fullPath), { recursive: true })
        await writeFile(fullPath, next, 'utf8')
      }
      results.push({ filePath: update.filePath, mode, changed })
    }

    return {
      ok: true,
      updates: results,
    }
  },
})
