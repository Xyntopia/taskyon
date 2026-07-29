import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const cachePath = (directory: string, url: string) =>
  join(directory, `${createHash('sha256').update(url).digest('hex')}.bin`)

const readCached = async (path: string) => {
  try {
    const data = await readFile(path)
    return Uint8Array.from(data).buffer
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export const createStaticEmbeddingAssetReader = (directory: string) => async (url: string) => {
  const path = cachePath(directory, url)
  const cached = await readCached(path)
  if (cached) return cached
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Static embedding asset failed: ${response.status} ${url}`)
  const data = Buffer.from(await response.arrayBuffer())
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, data)
  await rename(temporaryPath, path)
  return Uint8Array.from(data).buffer
}
