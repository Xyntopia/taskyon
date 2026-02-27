import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MSL_VERSION = process.env.MSL_VERSION || '4.1.0'
const TARGET_DIR = process.env.MSL_TARGET_DIR || 'public/msl'
const TARGET_FILE = process.env.MSL_TARGET_FILE || `ModelicaStandardLibrary-${MSL_VERSION}.zip`
const TARGET_PATH = join(TARGET_DIR, TARGET_FILE)
const SOURCE_URL =
  process.env.MSL_SOURCE_URL ||
  `https://github.com/modelica/ModelicaStandardLibrary/archive/refs/tags/v${MSL_VERSION}.zip`
const FORCE = process.env.MSL_FORCE_DOWNLOAD === '1'

async function fileLooksUsable(path) {
  try {
    const s = await stat(path)
    return s.isFile() && s.size > 1024
  } catch {
    return false
  }
}

async function main() {
  if (!FORCE && (await fileLooksUsable(TARGET_PATH))) {
    console.log(`[ensure-msl] using cached ${TARGET_PATH}`)
    return
  }

  await mkdir(dirname(TARGET_PATH), { recursive: true })

  console.log(`[ensure-msl] downloading ${SOURCE_URL}`)
  const res = await fetch(SOURCE_URL)
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength <= 1024) {
    throw new Error('download failed: response is unexpectedly small')
  }

  await writeFile(TARGET_PATH, bytes)
  console.log(`[ensure-msl] wrote ${TARGET_PATH} (${bytes.byteLength} bytes)`)
}

main().catch((err) => {
  console.error(`[ensure-msl] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
