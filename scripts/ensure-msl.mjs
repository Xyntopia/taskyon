import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const MSL_VERSION = process.env.MSL_VERSION || '4.1.0'
const TARGET_DIR = process.env.MSL_TARGET_DIR || 'public/modelica-libraries'
const LEGACY_TARGET_DIR = 'public/msl'
const FORCE = process.env.MSL_FORCE_DOWNLOAD === '1'
const LIBRARIES_JSON_PATH = resolve('packages/shared/modelica/modelica_libraries.json')
const MSL_FILE_NAME = process.env.MSL_TARGET_FILE || `ModelicaStandardLibrary-${MSL_VERSION}.zip`
const MSL_SOURCE_URL =
  process.env.MSL_SOURCE_URL ||
  `https://github.com/modelica/ModelicaStandardLibrary/archive/refs/tags/v${MSL_VERSION}.zip`

const isDefaultTargetDir = TARGET_DIR === 'public/modelica-libraries'

function sanitizeFileStem(value) {
  const stem = String(value || '')
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
  return stem.length > 0 ? stem : 'library'
}

function fileNameFromManifestEntry(name) {
  return `${sanitizeFileStem(name)}.zip`
}

async function fileLooksUsable(path) {
  try {
    const s = await stat(path)
    return s.isFile() && s.size > 1024
  } catch {
    return false
  }
}

async function readLibraryManifest(path) {
  const jsonText = await readFile(path, 'utf8')
  const parsed = JSON.parse(jsonText)
  const libraries = Array.isArray(parsed?.libraries) ? parsed.libraries : []
  return libraries
    .map((entry) => {
      const name = String(entry?.name || '').trim()
      const downloadUrl = String(entry?.download_url || '').trim()
      if (!name || !downloadUrl) return null
      return {
        name,
        url: downloadUrl,
        fileName: fileNameFromManifestEntry(name),
      }
    })
    .filter(Boolean)
}

async function downloadToPath(url, targetPath) {
  await mkdir(dirname(targetPath), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength <= 1024) {
    throw new Error('download failed: response is unexpectedly small')
  }
  await writeFile(targetPath, bytes)
  return bytes.byteLength
}

async function ensureDownload({ url, targetPath }) {
  if (!FORCE && (await fileLooksUsable(targetPath))) {
    console.log(`[ensure-msl] using cached ${targetPath}`)
    return
  }
  console.log(`[ensure-msl] downloading ${url}`)
  const size = await downloadToPath(url, targetPath)
  console.log(`[ensure-msl] wrote ${targetPath} (${size} bytes)`)
}

async function cleanupLegacyMslDir() {
  if (!isDefaultTargetDir) return
  if (TARGET_DIR === LEGACY_TARGET_DIR) return
  try {
    await rm(LEGACY_TARGET_DIR, { recursive: true, force: true })
    console.log(`[ensure-msl] removed legacy directory ${LEGACY_TARGET_DIR}`)
  } catch (err) {
    throw new Error(
      `failed to remove legacy directory ${LEGACY_TARGET_DIR}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

async function main() {
  const manifestLibraries = await readLibraryManifest(LIBRARIES_JSON_PATH)
  const requestedLibraries = [
    ...manifestLibraries,
    {
      name: `ModelicaStandardLibrary-${MSL_VERSION}`,
      url: MSL_SOURCE_URL,
      fileName: MSL_FILE_NAME,
    },
  ]
  const seenFileNames = new Set()
  const allLibraries = requestedLibraries.filter((library) => {
    const key = String(library.fileName || '').trim().toLowerCase()
    if (!key) return false
    if (seenFileNames.has(key)) return false
    seenFileNames.add(key)
    return true
  })

  for (const library of allLibraries) {
    const targetPath = join(TARGET_DIR, library.fileName)
    await ensureDownload({ url: library.url, targetPath })
  }

  await cleanupLegacyMslDir()
  console.log(`[ensure-msl] completed download of ${allLibraries.length} archives to ${TARGET_DIR}`)
}

main().catch((err) => {
  console.error(`[ensure-msl] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
