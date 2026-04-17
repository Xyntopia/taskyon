import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { createTool } from '../../../taskyon/src/types/toolApi.ts'
import {
  applyFileUpdateToContent,
  getFileUpdateMode,
  normalizeFileUpdate,
  type FileUpdate,
} from '../../../taskyon-vscode/src/patching.ts'

type UpdateFilesArgs = {
  updates: FileUpdate[]
}

export const updateFilesTool = createTool({
  name: 'updateFiles',
  description:
    'Apply VSCode-style file updates. Each update must use exactly one mode: newContent, patches, or regexReplacements.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['updates'],
    properties: {
      updates: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['filePath'],
          properties: {
            filePath: { type: 'string' },
            newContent: { type: 'string' },
            patches: {
              type: 'array',
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
  function: async ({ updates }: UpdateFilesArgs) => {
    const results: Array<{ filePath: string; mode: string; changed: boolean }> = []

    for (const rawUpdate of updates) {
      const update = normalizeFileUpdate(rawUpdate)
      const mode = getFileUpdateMode(update)
      const fullPath = join(process.cwd(), update.filePath)
      const current = await readFile(fullPath, 'utf8')
      const next = applyFileUpdateToContent(current, update)
      const changed = next !== current
      if (changed) await writeFile(fullPath, next, 'utf8')
      results.push({ filePath: update.filePath, mode, changed })
    }

    return {
      ok: true,
      updates: results,
    }
  },
})
