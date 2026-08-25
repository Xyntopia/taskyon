import { createTool } from '@taskyon/taskyon/api'
import type { WorkspaceOperations } from '@taskyon/taskyon/tools/workspaceTools'
import {
  applyFileUpdateToContent,
  getFileUpdateMode,
  normalizeFileUpdate,
  type FileUpdate,
} from '@taskyon/taskyon/tools/filePatching'
import { assertPathInsideArtifactRoot } from './workspacePaths'
import { createNodeWorkspaceOperations } from './nodeWorkspaceOperations'

type UpdateFilesArgs = {
  updates: FileUpdate[]
  artifactRoot?: string
}

const isMissingFileError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

export const createUpdateFilesTool = (
  workspace: WorkspaceOperations = createNodeWorkspaceOperations(),
) =>
  createTool({
    name: 'updateFiles',
    description: 'Create or edit one or more workspace text files with explicit replacement modes.',
    longDescription:
      'Every requested path is confined to the workspace and each update uses exactly one mode: complete content, exact-context patches, or regular-expression replacements. The tool validates all updates before writing and reports mismatches instead of silently applying approximate edits.',
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
      const files = new Map<
        string,
        { current: { content: string; revision: string | null }; next: string }
      >()
      const results: Array<{ filePath: string; mode: string; changed: boolean }> = []
      for (const rawUpdate of updates) {
        const update = normalizeFileUpdate(rawUpdate)
        assertPathInsideArtifactRoot(update.filePath, artifactRoot)
        const mode = getFileUpdateMode(update)
        let file = files.get(update.filePath)
        if (!file) {
          const current = await workspace.read(update.filePath).catch((error: unknown) => {
            if (mode === 'newContent' && isMissingFileError(error)) {
              return { content: '', revision: null }
            }
            throw error
          })
          file = { current, next: current.content }
          files.set(update.filePath, file)
        }
        const next = applyFileUpdateToContent(file.next, update)
        results.push({ filePath: update.filePath, mode, changed: next !== file.next })
        file.next = next
      }

      await Promise.all(
        [...files].map(async ([path, { current, next }]) => {
          if (next === current.content) return
          await workspace.write({
            path,
            content: next,
            expectedRevision: current.revision,
          })
        }),
      )

      return {
        ok: true,
        updates: results,
      }
    },
  })
