import { SPACESHIP_IDENTICON_VERSION } from './proceduralSpaceshipVersion.js'
import type {
  GridSizeConfig,
  RewindPolicy,
  SpaceshipModuleDefinition,
  StagesConfig,
} from './spaceshipSchemas'

export type SpaceshipImageOptions = {
  size: number
  showStars: boolean
  showBackground: boolean
  backgroundFill: string
  renderMode: 'png-first' | 'svg-only'
  disableCache: boolean
  clearCache?: boolean
  debugBounds: boolean
  moduleLibrary: SpaceshipModuleDefinition[]
  symmetry: boolean
  focusedModuleId?: string
  stages: StagesConfig
  gridSize: GridSizeConfig
  randomSvgColors: boolean
  maxGlobalRewinds?: number
  maxIntraStageBacktracks?: number
  rewindPolicy?: RewindPolicy
  stagnationRepeatThreshold?: number
  preferDeeperRewindOnRepeat?: boolean
}

export type SpaceshipImageResult =
  | { kind: 'png'; blob: Blob; cacheHit: boolean }
  | { kind: 'svg'; svg: string; cacheHit: false }

const CACHE_ROOT = 'spaceship-identicons'

export async function clearSpaceshipImageCache() {
  const root = await getOpfsRoot()
  if (!root) return
  try {
    const imageDir = await root.getDirectoryHandle(CACHE_ROOT)
    await imageDir.removeEntry(SPACESHIP_IDENTICON_VERSION, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/notfound|no such file|does not exist/i.test(message)) return
    console.warn('Failed to clear spaceship identicon cache directory.', error)
  }
}

export function normalizeSpaceshipSeed(seedText: string) {
  return seedText.trim() || 'untitled'
}

export async function getSpaceshipImage(seedText: string, options: SpaceshipImageOptions): Promise<SpaceshipImageResult> {
  const normalizedSeed = normalizeSpaceshipSeed(seedText)
  const shouldUseCache = options.renderMode !== 'svg-only' && !options.disableCache

  if (shouldUseCache) {
    if (options.clearCache) await removeCachedPngBlob(normalizedSeed, options)
    else {
      const cachedBlob = await readCachedPngBlob(normalizedSeed, options)
      if (cachedBlob) return { kind: 'png', blob: cachedBlob, cacheHit: true }
    }
  }

  const spaceshipModule = await import('./proceduralSpaceship.js')
  const svg = spaceshipModule.renderSpaceshipSvg(normalizedSeed, options)

  if (options.renderMode === 'svg-only') return { kind: 'svg', svg, cacheHit: false }

  try {
    const png = await renderSvgToSquarePngUint8(svg, options.size)
    const blob = new Blob([new Uint8Array(png).slice().buffer], { type: 'image/png' })
    if (shouldUseCache) await writeCachedPngBlob(normalizedSeed, options, blob)
    return { kind: 'png', blob, cacheHit: false }
  } catch (error) {
    console.warn('Failed to render spaceship identicon PNG, falling back to SVG.', error)
    return { kind: 'svg', svg, cacheHit: false }
  }
}

async function renderSvgToSquarePngUint8(svg: string, size: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('2D context unavailable')
  // Start from a transparent canvas so SVG alpha is preserved in cached PNG output.
  // `alpha: true` plus clearRect keeps the background transparent when the SVG has no background.
  ctx.clearRect(0, 0, size, size)

  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to decode SVG for square PNG render.'))
      img.src = url
    })
    const scale = Math.min(size / image.width, size / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const drawX = (size - drawWidth) / 2
    const drawY = (size - drawHeight) / 2
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  } finally {
    URL.revokeObjectURL(url)
  }

  const pngBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png')
  })
  if (!pngBlob) throw new Error('Failed to encode square PNG.')
  return new Uint8Array(await pngBlob.arrayBuffer())
}

async function readCachedPngBlob(seedText: string, options: SpaceshipImageOptions): Promise<Blob | null> {
  const fileHandle = await getCacheFileHandle(seedText, options, false)
  if (!fileHandle) return null
  try {
    const file = await fileHandle.getFile()
    if (file.size === 0) return null
    return file
  } catch (error) {
    console.warn('Failed to read cached spaceship identicon PNG.', error)
    return null
  }
}

async function removeCachedPngBlob(seedText: string, options: SpaceshipImageOptions) {
  const root = await getOpfsRoot()
  if (!root) return
  try {
    const imageDir = await root.getDirectoryHandle(CACHE_ROOT)
    const versionDir = await imageDir.getDirectoryHandle(SPACESHIP_IDENTICON_VERSION)
    await versionDir.removeEntry(getCacheFileName(seedText, options))
  } catch (error) {
    // Missing cache entries are expected in normal operation.
    const message = error instanceof Error ? error.message : String(error)
    if (/notfound|no such file|does not exist/i.test(message)) return
    console.warn('Failed to clear cached spaceship identicon PNG.', error)
  }
}

async function writeCachedPngBlob(seedText: string, options: SpaceshipImageOptions, blob: Blob) {
  const fileHandle = await getCacheFileHandle(seedText, options, true)
  if (!fileHandle) return
  try {
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    console.warn('Failed to write cached spaceship identicon PNG.', error)
  }
}

async function getCacheFileHandle(seedText: string, options: SpaceshipImageOptions, create: boolean): Promise<FileSystemFileHandle | null> {
  const root = await getOpfsRoot()
  if (!root) return null
  try {
    const imageDir = await root.getDirectoryHandle(CACHE_ROOT, { create })
    const versionDir = await imageDir.getDirectoryHandle(SPACESHIP_IDENTICON_VERSION, { create })
    return await versionDir.getFileHandle(getCacheFileName(seedText, options), { create })
  } catch (error) {
    console.warn('Failed to access spaceship identicon cache directory.', error)
    return null
  }
}

function getCacheFileName(seedText: string, options: SpaceshipImageOptions) {
  return `${createCacheKey(seedText, options)}.png`
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  const storage = navigator.storage
  if (!storage?.getDirectory) return null
  try {
    return await storage.getDirectory()
  } catch (error) {
    console.warn('Failed to access OPFS root for spaceship identicons.', error)
    return null
  }
}

function createCacheKey(seedText: string, options: SpaceshipImageOptions) {
  const stableOptions = { ...options }
  delete stableOptions.clearCache
  return hashString(
    JSON.stringify({ seedText, options: stableOptions, version: SPACESHIP_IDENTICON_VERSION }),
  ).toString(16)
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
