import type { ResourceFilesLoader } from '@taskyon/common/modules/resourceFiles'
import type { TaskyonApiDescription } from '../api/taskyonOpenApi'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

const listFilesIteratively = async (root: string): Promise<string[]> => {
  const pending = [root]
  const files: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) continue
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      if (entry.isFile()) files.push(path)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

export const createNodeResourceFilesLoader = (
  docsRoot: string,
  describeApi: () => Promise<TaskyonApiDescription>,
): ResourceFilesLoader =>
  async function* (source) {
    if (source === '/resources/peers/local/api') {
      const description = await describeApi()
      yield {
        url: source,
        file: new File([JSON.stringify(description.document)], 'taskyon.openapi.json', {
          type: 'application/vnd.oai.openapi+json',
        }),
      }
      return
    }
    if (!source.startsWith('/docs/')) {
      throw new Error(`Unsupported Node documentation source: ${source}`)
    }

    const relativeSource = source.slice('/docs/'.length).replace(/\/$/, '')
    const sourcePath = join(docsRoot, relativeSource)
    const sourceStats = await stat(sourcePath)
    const files = sourceStats.isDirectory() ? await listFilesIteratively(sourcePath) : [sourcePath]
    for (const path of files) {
      const relativePath = relative(docsRoot, path).replaceAll('\\', '/')
      const content = Uint8Array.from(await readFile(path))
      yield {
        url: `/docs/${relativePath}`,
        file: new File([content], basename(path), {
          type: path.endsWith('.md') ? 'text/markdown' : 'application/octet-stream',
        }),
      }
    }
  }
