import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'
import { createTool } from '../../../taskyon/src/types/toolApi.ts'

type ExplorationContext = Record<string, string>

type ExplorationArgs = {
  action: 'list' | 'search' | 'view' | 'add' | 'context' | 'clear_context'
  query?: string
  path?: string
  limit?: number
}

async function listFilesRec(root: string, limit: number, query?: string) {
  const out: string[] = []
  const walk = async (dir: string) => {
    if (out.length >= limit) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (out.length >= limit) break
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const rel = relative(root, full)
      if (!query || rel.toLowerCase().includes(query.toLowerCase())) out.push(rel)
    }
  }
  await walk(root)
  return out
}

export function formatExplorationContext(contextFiles: ExplorationContext) {
  const keys = Object.keys(contextFiles)
  if (keys.length <= 0) return 'Loaded file context: (none)'
  const body = keys
    .slice(0, 20)
    .map((filePath) => {
      const content = contextFiles[filePath] ?? ''
      const clipped = content.split('\n').slice(0, 120).join('\n')
      return `### ${filePath}\n\n\`\`\`\n${clipped}\n\`\`\``
    })
    .join('\n\n')
  return `Loaded file context (${keys.length} files):\n\n${body}`
}

export function createExplorationTool(contextFiles: ExplorationContext) {
  return createTool({
    name: 'exploration',
    description: 'Explore workspace files and manage a file-context store for the CLI entry node.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'search', 'view', 'add', 'context', 'clear_context'],
        },
        query: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'integer', default: 50 },
      },
    } as const,
    function: async ({ action, query, path, limit = 50 }: ExplorationArgs) => {
      const cwd = process.cwd()
      if (action === 'clear_context') {
        Object.keys(contextFiles).forEach((k) => delete contextFiles[k])
        return { cleared: true }
      }
      if (action === 'context') {
        const files = Object.keys(contextFiles)
        return {
          files,
          count: files.length,
          chars: files.reduce((n, f) => n + (contextFiles[f]?.length ?? 0), 0),
        }
      }
      if (action === 'view') {
        if (!path) throw new Error('path is required for view action')
        const full = join(cwd, path)
        const content = await readFile(full, 'utf8')
        return { path, content }
      }
      if (action === 'add') {
        if (!path) throw new Error('path is required for add action')
        const full = join(cwd, path)
        const content = await readFile(full, 'utf8')
        contextFiles[path] = content
        return { added: path, chars: content.length }
      }
      const files = await listFilesRec(cwd, Math.max(1, Math.min(limit, 200)), action === 'search' ? query : undefined)
      return { files, count: files.length }
    },
  })
}
