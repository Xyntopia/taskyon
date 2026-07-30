import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'

type ModelicaLibraryManifestEntry = {
  id: string
  name: string
  fileName: string
  downloadUrl: string
  mirrorUrl: string
  sizeBytes?: number
  sha256?: string
}

type ModelicaLibraryManifest = {
  mirrorManifestUrl: string
  libraries: ModelicaLibraryManifestEntry[]
}

const BUNDLED_MANIFEST_URL = new URL('./modelica_libraries.json', import.meta.url)
const ARCHIVE_NAMESPACE = 'modelica/library-archives'
const INDEX_NAMESPACE = 'modelica/library-cache-index'
const DEFAULT_LIBRARY_ID_PREFIX = 'ModelicaStandardLibrary-'

export const resolveBundledRumocaWasmPath = (): string => {
  const packageDir = dirname(fileURLToPath(import.meta.resolve('rumoca-full-web')))
  return join(packageDir, 'rumoca_bind_wasm_bg.wasm')
}

const stringField = (source: Record<string, unknown>, key: string) => {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}

const parseManifestEntry = (raw: unknown): ModelicaLibraryManifestEntry | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const name = stringField(source, 'name')
  const id = stringField(source, 'id') || name
  const downloadUrl = stringField(source, 'download_url')
  const mirrorUrl = stringField(source, 'mirror_url')
  if (!id || (!downloadUrl && !mirrorUrl)) return null
  const entry: ModelicaLibraryManifestEntry = {
    id,
    name: name || id,
    fileName: stringField(source, 'file_name') || `${id}.zip`,
    downloadUrl,
    mirrorUrl,
  }
  const sizeBytes = source.size_bytes
  if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes)) entry.sizeBytes = sizeBytes
  const sha256 = stringField(source, 'sha256')
  if (sha256) entry.sha256 = sha256
  return entry
}

const parseManifest = (raw: unknown): ModelicaLibraryManifest => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Modelica library manifest is not an object')
  }
  const source = raw as Record<string, unknown>
  if (!Array.isArray(source.libraries)) {
    throw new Error('Modelica library manifest does not contain a libraries array')
  }
  return {
    mirrorManifestUrl: stringField(source, 'mirror_manifest_url'),
    libraries: source.libraries.map(parseManifestEntry).filter((entry) => entry !== null),
  }
}

const readBundledManifest = async () =>
  parseManifest(JSON.parse(await readFile(BUNDLED_MANIFEST_URL, 'utf8')))

const loadManifest = async () => {
  const bundled = await readBundledManifest()
  if (!bundled.mirrorManifestUrl) return bundled
  try {
    const response = await fetch(bundled.mirrorManifestUrl, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseManifest(await response.json())
  } catch (error) {
    console.warn(
      `[modelica-library-cache] using bundled manifest after remote refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return bundled
  }
}

const findLibrary = (manifest: ModelicaLibraryManifest, prefix: string) => {
  const library = manifest.libraries.find(
    (entry) => entry.id.startsWith(prefix) || entry.name.startsWith(prefix),
  )
  if (!library) throw new Error(`No Modelica library found for prefix ${prefix}`)
  return library
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

const validArchive = (data: Uint8Array, library: ModelicaLibraryManifestEntry) =>
  data.byteLength > 1024 &&
  (library.sizeBytes === undefined || data.byteLength === library.sizeBytes) &&
  (!library.sha256 || sha256(data) === library.sha256)

const readCachedArchive = async (
  storageClient: TaskyonStorageClient,
  library: ModelicaLibraryManifestEntry,
) => {
  const indexed = await storageClient.get({ namespace: INDEX_NAMESPACE, id: library.id })
  if (typeof indexed.value !== 'string') return null
  const stored = await storageClient.getBlob({ namespace: ARCHIVE_NAMESPACE, id: indexed.value })
  return stored && validArchive(stored.data, library)
    ? { id: indexed.value, data: stored.data }
    : null
}

const downloadArchive = async (library: ModelicaLibraryManifestEntry) => {
  let lastError = 'no URL worked'
  const sources = [library.mirrorUrl, library.downloadUrl].filter(
    (url, index, urls) => url && urls.indexOf(url) === index,
  )
  for (const url of sources) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        continue
      }
      const data = new Uint8Array(await response.arrayBuffer())
      if (!validArchive(data, library)) {
        lastError = 'downloaded bytes failed size or hash validation'
        continue
      }
      return data
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Failed to download Modelica library archive: ${lastError}`)
}

export const resolveCachedModelicaLibraryZip = async (
  storageClient: TaskyonStorageClient,
  options: { libraryIdPrefix?: string } = {},
) => {
  const manifest = await loadManifest()
  const library = findLibrary(manifest, options.libraryIdPrefix || DEFAULT_LIBRARY_ID_PREFIX)
  const cached = await readCachedArchive(storageClient, library)
  if (cached) return cached

  const data = await downloadArchive(library)
  const id = sha256(data)
  await storageClient.setBlob({
    namespace: ARCHIVE_NAMESPACE,
    id,
    data,
    contentType: 'application/zip',
  })
  await storageClient.set({ namespace: INDEX_NAMESPACE, id: library.id, value: id })
  return { id, data }
}

export const modelicaLibraryManifestFilePath = () => fileURLToPath(BUNDLED_MANIFEST_URL)
