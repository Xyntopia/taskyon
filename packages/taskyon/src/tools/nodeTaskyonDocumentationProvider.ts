import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { JSONSchema7 } from 'json-schema'
import { createClientTool } from '../types/toolApi'

const docsProviderToolName = 'getTaskyonDocumentationDocuments'

const listMarkdownFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return await listMarkdownFiles(path)
      if (entry.isFile() && entry.name.endsWith('.md')) return [path]
      return []
    }),
  )
  return nested.flat().sort((left, right) => left.localeCompare(right))
}

const titleFromPath = (path: string) =>
  path.split('/').pop()?.replace(/\.md$/, '').replace(/[_-]+/g, ' ') ?? path

const loadTaskyonDocumentationDocuments = async () => {
  const docsRoot = join(process.cwd(), 'public', 'docs')
  const files = await listMarkdownFiles(docsRoot)
  const documents = await Promise.all(
    files.map(async (file) => {
      const path = relative(docsRoot, file).replaceAll('\\', '/')
      return {
        id: path,
        path,
        title: titleFromPath(path),
        url: `/docs/${path}`,
        content: await readFile(file, 'utf8'),
        metadata: {
          source: 'taskyon-public-docs',
        },
      }
    }),
  )
  return { documents }
}

export const createNodeTaskyonDocumentationProviderTool = () =>
  createClientTool({
    function: loadTaskyonDocumentationDocuments,
    description: 'Load the bundled Taskyon markdown documentation for local indexing.',
    longDescription:
      'Node-side provider for the Taskyon documentation workflow. It mirrors the browser provider by reading public/docs markdown files and returning their content.',
    name: docsProviderToolName,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const satisfies JSONSchema7,
  })
