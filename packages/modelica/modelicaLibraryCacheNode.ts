import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

type CacheOptions = {
  libraryIdPrefix?: string
  envOverridePath?: string
}

type DownloadSource = {
  label: string
  url: string
}

const BUNDLED_MANIFEST_URL = new URL('./modelica_libraries.json', import.meta.url)
const CACHE_DIR_NAME = 'modelica-libraries'
const DEFAULT_LIBRARY_ID_PREFIX = 'ModelicaStandardLibrary-'

export const resolveBundledRumocaWasmPath = (): string => {
  const packageDir = dirname(fileURLToPath(import.meta.resolve('rumoca-full-web')))
  return join(packageDir, 'rumoca_bind_wasm_bg.wasm')
}

const readOptionalString = (source: Record<string, unknown>, key: string): string => {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}

const readOptionalNumber = (source: Record<string, unknown>, key: string): number | undefined => {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const sanitizeFileStem = (value: string): string => {
  const stem = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return stem || 'modelica-library'
}

const parseManifestEntry = (raw: unknown): ModelicaLibraryManifestEntry | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const name = readOptionalString(source, 'name')
  const id = readOptionalString(source, 'id') || sanitizeFileStem(name)
  const fileName = readOptionalString(source, 'file_name') || `${id}.zip`
  const downloadUrl = readOptionalString(source, 'download_url')
  const mirrorUrl = readOptionalString(source, 'mirror_url')
  if (!id || (!downloadUrl && !mirrorUrl)) return null
  const entry: ModelicaLibraryManifestEntry = {
    id,
    name: name || id,
    fileName,
    downloadUrl,
    mirrorUrl,
  }
  const sizeBytes = readOptionalNumber(source, 'size_bytes')
  const sha256 = readOptionalString(source, 'sha256')
  if (sizeBytes !== undefined) entry.sizeBytes = sizeBytes
  if (sha256) entry.sha256 = sha256
  return entry
}

const isManifestEntry = (
  entry: ModelicaLibraryManifestEntry | null,
): entry is ModelicaLibraryManifestEntry => entry !== null

const parseManifest = (raw: unknown): ModelicaLibraryManifest => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Modelica library manifest is not an object')
  }
  const source = raw as Record<string, unknown>
  const rawLibraries = source.libraries
  if (!Array.isArray(rawLibraries)) {
    throw new Error('Modelica library manifest does not contain a libraries array')
  }
  return {
    mirrorManifestUrl: readOptionalString(source, 'mirror_manifest_url'),
    libraries: rawLibraries.map(parseManifestEntry).filter(isManifestEntry),
  }
}

async function readBundledManifest(): Promise<ModelicaLibraryManifest> {
  const raw = await readFile(BUNDLED_MANIFEST_URL, 'utf8')
  return parseManifest(JSON.parse(raw))
}

async function readRemoteManifest(url: string): Promise<ModelicaLibraryManifest> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Failed to refresh Modelica library manifest: HTTP ${response.status}`)
  }
  return parseManifest(await response.json())
}

async function loadModelicaLibraryManifest(): Promise<ModelicaLibraryManifest> {
  const bundled = await readBundledManifest()
  if (!bundled.mirrorManifestUrl) return bundled
  try {
    return await readRemoteManifest(bundled.mirrorManifestUrl)
  } catch (error) {
    console.warn(
      `[modelica-library-cache] using bundled manifest after remote refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return bundled
  }
}

async function firstWritableDirectory(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await mkdir(candidate, { recursive: true })
      await access(candidate, constants.W_OK)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`No writable Modelica library cache directory found: ${candidates.join(', ')}`)
}

async function resolveModelicaLibraryCacheDir(): Promise<string> {
  const home = homedir()
  const xdgCacheHome = process.env.XDG_CACHE_HOME?.trim()
  const explicit = process.env.TASKYON_MODELICA_LIBRARY_CACHE_DIR?.trim()
  const candidates = [
    explicit || '',
    xdgCacheHome ? join(xdgCacheHome, 'taskyon', CACHE_DIR_NAME) : '',
    home ? join(home, '.cache', 'taskyon', CACHE_DIR_NAME) : '',
    join(tmpdir(), 'taskyon', CACHE_DIR_NAME),
  ].filter(Boolean)
  return await firstWritableDirectory(candidates)
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

async function cachedFileMatches(
  path: string,
  library: ModelicaLibraryManifestEntry,
): Promise<boolean> {
  try {
    const details = await stat(path)
    if (library.sizeBytes !== undefined && details.size !== library.sizeBytes) return false
    if (library.sha256 && (await sha256File(path)) !== library.sha256) return false
    return details.size > 1024
  } catch {
    return false
  }
}

function buildCacheFileName(library: ModelicaLibraryManifestEntry): string {
  const stem = sanitizeFileStem(library.id || library.name)
  if (library.sha256) return `${stem}-${library.sha256}.zip`
  return library.fileName || `${stem}.zip`
}

function buildDownloadSources(library: ModelicaLibraryManifestEntry): DownloadSource[] {
  const sources = [
    { label: 'mirror', url: library.mirrorUrl },
    { label: 'upstream', url: library.downloadUrl },
  ].filter((source) => source.url)
  return sources.filter(
    (source, index) => sources.findIndex((candidate) => candidate.url === source.url) === index,
  )
}

async function downloadToFile(sources: DownloadSource[], targetPath: string): Promise<string> {
  let lastError = ''
  for (const source of sources) {
    try {
      console.log(`[modelica-library-cache] downloading ${source.label}: ${source.url}`)
      const response = await fetch(source.url)
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        continue
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength <= 1024) {
        lastError = 'response is unexpectedly small'
        continue
      }
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, bytes)
      return source.url
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Failed to download Modelica library archive: ${lastError || 'no URL worked'}`)
}

function findLibrary(
  manifest: ModelicaLibraryManifest,
  libraryIdPrefix: string,
): ModelicaLibraryManifestEntry {
  const library = manifest.libraries.find(
    (entry) => entry.id.startsWith(libraryIdPrefix) || entry.name.startsWith(libraryIdPrefix),
  )
  if (!library) throw new Error(`No Modelica library found for prefix ${libraryIdPrefix}`)
  return library
}

async function assertOverridePath(path: string): Promise<string> {
  await access(path)
  return path
}

export async function resolveCachedModelicaLibraryZipPath(
  options: CacheOptions = {},
): Promise<string> {
  const overridePath =
    options.envOverridePath?.trim() || process.env.MODELICA_DIAG_MSL_ZIP_PATH?.trim()
  if (overridePath) return await assertOverridePath(overridePath)

  const manifest = await loadModelicaLibraryManifest()
  const library = findLibrary(manifest, options.libraryIdPrefix || DEFAULT_LIBRARY_ID_PREFIX)
  const cacheDir = await resolveModelicaLibraryCacheDir()
  const targetPath = join(cacheDir, buildCacheFileName(library))
  if (await cachedFileMatches(targetPath, library)) return targetPath

  const usedUrl = await downloadToFile(buildDownloadSources(library), targetPath)
  if (!(await cachedFileMatches(targetPath, library))) {
    throw new Error(`Downloaded Modelica library failed cache validation: ${usedUrl}`)
  }
  return targetPath
}

export function modelicaLibraryManifestFilePath(): string {
  return fileURLToPath(BUNDLED_MANIFEST_URL)
}
