import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SearchIndexDocument } from '@taskyon/taskyon/api'

const recordPath = (directory: string, id: string) => {
  const hash = createHash('sha256').update(id).digest('hex')
  return join(directory, hash.slice(0, 2), hash.slice(2, 4), `${hash}.json`)
}

const listJsonFiles = async (directory: string): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return await listJsonFiles(path)
        return entry.isFile() && entry.name.endsWith('.json') ? [path] : []
      }),
    )
    return nested.flat()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

export const loadTaskSearchSidecars = async (directory: string) => {
  const files = await listJsonFiles(directory)
  const documents = await Promise.all(
    files.map(async (path) => SearchIndexDocument.parse(JSON.parse(await readFile(path, 'utf8')))),
  )
  return documents
}

const writeAtomically = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export const saveTaskSearchSidecars = async (
  directory: string,
  documents: readonly SearchIndexDocument[],
) => {
  await Promise.all(
    documents.map((document) => writeAtomically(recordPath(directory, document.id), document)),
  )
}
