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
    'Create or edit workspace files. Each update must use exactly one mode: newContent, patches, or regexReplacements. Use newContent by itself when creating or fully replacing a file. If a patch or regex update fails, re-read the file before retrying; for small generated files prefer one complete newContent replacement over repeated approximate patches.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['updates'],
    properties: {
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative directory that all files in this one updateFiles call must stay under, for example research/solar-cell-spec-sheets/. Omit artifactRoot when the same call also writes top-level files such as README.md, or split those writes into a separate updateFiles call.',
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
            filePath: {
              type: 'string',
              description:
                'Workspace-relative path. When artifactRoot is provided, repeat that directory prefix in filePath; for example artifactRoot research/topic/ requires filePath research/topic/sources.md, not sources.md.',
            },
            newContent: {
              type: 'string',
              description:
                'Complete file contents for creating a new file or replacing an existing file. Do not include patches or regexReplacements with this mode.',
            },
            patches: {
              type: 'array',
              minItems: 1,
              description:
                'Search/replace patches for an existing file. Do not include newContent or regexReplacements with this mode. Use exact current context; after a mismatch, inspect the file again before retrying. For Markdown or other small generated sections, prefer newContent for the full file over repeated fragile boundary patches.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  search: {
                    type: 'string',
                    description: 'Exact text to replace. Prefer this when the block is not huge.',
                  },
                  searchStart: {
                    type: 'string',
                    description:
                      'Exact start boundary for a large replacement. Must contain at least 3 complete lines from the current file.',
                  },
                  searchEnd: {
                    type: 'string',
                    description:
                      'Exact end boundary for a large replacement. Must contain at least 3 complete lines from the current file.',
                  },
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
