import { SPACESHIP_IDENTICON_VERSION } from './proceduralSpaceshipVersion.js'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
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

const CACHE_NAMESPACE = `spaceship-identicons/${SPACESHIP_IDENTICON_VERSION}`

export const clearSpaceshipImageCache = async (storageClient: TaskyonStorageClient) =>
  await storageClient.clearBlobs({ namespace: CACHE_NAMESPACE })

export function normalizeSpaceshipSeed(seedText: string) {
  return seedText.trim() || 'untitled'
}

export async function getSpaceshipImage(
  storageClient: TaskyonStorageClient,
  seedText: string,
  options: SpaceshipImageOptions,
): Promise<SpaceshipImageResult> {
  const normalizedSeed = normalizeSpaceshipSeed(seedText)
  const shouldUseCache = options.renderMode !== 'svg-only' && !options.disableCache

  if (shouldUseCache) {
    if (options.clearCache) await removeCachedPngBlob(storageClient, normalizedSeed, options)
    else {
      const cachedBlob = await readCachedPngBlob(storageClient, normalizedSeed, options)
      if (cachedBlob) return { kind: 'png', blob: cachedBlob, cacheHit: true }
    }
  }

  const spaceshipModule = await import('./proceduralSpaceship.js')
  const svg = spaceshipModule.renderSpaceshipSvg(normalizedSeed, options)

  if (options.renderMode === 'svg-only') return { kind: 'svg', svg, cacheHit: false }

  try {
    const png = await renderSvgToSquarePngUint8(svg, options.size)
    const blob = new Blob([new Uint8Array(png).slice().buffer], { type: 'image/png' })
    if (shouldUseCache) await writeCachedPngBlob(storageClient, normalizedSeed, options, blob)
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

async function readCachedPngBlob(
  storageClient: TaskyonStorageClient,
  seedText: string,
  options: SpaceshipImageOptions,
): Promise<Blob | null> {
  const stored = await storageClient.getBlob({
    namespace: CACHE_NAMESPACE,
    id: getCacheId(seedText, options),
  })
  return stored
    ? new Blob([stored.data], { type: stored.metadata.contentType ?? 'image/png' })
    : null
}

const removeCachedPngBlob = async (
  storageClient: TaskyonStorageClient,
  seedText: string,
  options: SpaceshipImageOptions,
) =>
  await storageClient.deleteBlob({
    namespace: CACHE_NAMESPACE,
    id: getCacheId(seedText, options),
  })

const writeCachedPngBlob = async (
  storageClient: TaskyonStorageClient,
  seedText: string,
  options: SpaceshipImageOptions,
  blob: Blob,
) =>
  await storageClient.setBlob({
    namespace: CACHE_NAMESPACE,
    id: getCacheId(seedText, options),
    data: new Uint8Array(await blob.arrayBuffer()),
    contentType: 'image/png',
  })

const getCacheId = (seedText: string, options: SpaceshipImageOptions) =>
  createCacheKey(seedText, options).slice('sha256:'.length)

function createCacheKey(seedText: string, options: SpaceshipImageOptions) {
  const stableOptions = { ...options }
  delete stableOptions.clearCache
  return canonicalHash({ seedText, options: stableOptions, version: SPACESHIP_IDENTICON_VERSION })
}
