import { z } from 'zod'
import { loadTokenizer } from './nlp'

export const DEFAULT_STATIC_EMBEDDING_MODEL =
  'taskyon/static-similarity-mrl-multilingual-v1-d256-int8'

const staticEmbeddingManifest = z.object({
  formatVersion: z.literal(1),
  dimensions: z.number().int().positive(),
  vocabularySize: z.number().int().positive(),
  embeddings: z.object({ file: z.string(), sha256: z.string() }),
  scales: z.object({ file: z.string(), sha256: z.string() }),
})

export type StaticEmbeddingModel = {
  dimensions: number
  vocabularySize: number
  embeddings: Int8Array
  scales: Float32Array
}

const loadedModels = new Map<string, Promise<StaticEmbeddingModel>>()
const modelBaseUrl = (model: string) => `https://huggingface.co/${model}/resolve/main`
const fetchModelAsset = (url: string) => fetch(url, { signal: AbortSignal.timeout(60_000) })
let configuredAssetReader: ((url: string) => Promise<ArrayBuffer>) | undefined

export const configureStaticEmbeddingAssetReader = (
  reader?: (url: string) => Promise<ArrayBuffer>,
) => {
  configuredAssetReader = reader
  loadedModels.clear()
}

const readAsset = async (url: string) => {
  if (configuredAssetReader) return await configuredAssetReader(url)
  if (typeof caches !== 'undefined') {
    const cache = await caches.open('taskyon-static-embeddings-v1')
    const cached = await cache.match(url)
    if (cached) return await cached.arrayBuffer()
    const response = await fetchModelAsset(url)
    if (!response.ok) throw new Error(`Static embedding asset failed: ${response.status} ${url}`)
    await cache.put(url, response.clone())
    return await response.arrayBuffer()
  }
  const response = await fetchModelAsset(url)
  if (!response.ok) throw new Error(`Static embedding asset failed: ${response.status} ${url}`)
  return await response.arrayBuffer()
}

const sha256 = async (data: ArrayBuffer) => {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

const readCheckedAsset = async (url: string, expected: string) => {
  const data = await readAsset(url)
  const actual = await sha256(data)
  const normalizedExpected = expected.replace(/^sha256:/, '').toLocaleLowerCase()
  if (actual !== normalizedExpected) throw new Error(`Checksum mismatch for ${url}`)
  return data
}

export const loadStaticEmbeddingModel = async (
  model = DEFAULT_STATIC_EMBEDDING_MODEL,
): Promise<StaticEmbeddingModel> => {
  const existing = loadedModels.get(model)
  if (existing) return await existing
  const loading = (async () => {
    const baseUrl = modelBaseUrl(model)
    const manifest = staticEmbeddingManifest.parse(
      JSON.parse(new TextDecoder().decode(await readAsset(`${baseUrl}/static-embedding.json`))),
    )
    const [embeddingBuffer, scaleBuffer] = await Promise.all([
      readCheckedAsset(`${baseUrl}/${manifest.embeddings.file}`, manifest.embeddings.sha256),
      readCheckedAsset(`${baseUrl}/${manifest.scales.file}`, manifest.scales.sha256),
    ])
    const embeddings = new Int8Array(embeddingBuffer)
    const scales = new Float32Array(scaleBuffer)
    if (embeddings.length !== manifest.vocabularySize * manifest.dimensions) {
      throw new Error('Static embedding matrix size does not match its manifest.')
    }
    if (scales.length !== manifest.vocabularySize) {
      throw new Error('Static embedding scale count does not match its manifest.')
    }
    return {
      dimensions: manifest.dimensions,
      vocabularySize: manifest.vocabularySize,
      embeddings,
      scales,
    }
  })()
  loadedModels.set(model, loading)
  try {
    return await loading
  } catch (error) {
    loadedModels.delete(model)
    throw error
  }
}

const normalize = (vector: number[]) => {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude)
}

export const poolStaticTokenEmbeddings = (
  model: StaticEmbeddingModel,
  ids: Array<number | bigint>,
  mask?: Array<number | bigint>,
) => {
  const vector = Array.from({ length: model.dimensions }, () => 0)
  let count = 0
  for (let tokenIndex = 0; tokenIndex < ids.length; tokenIndex += 1) {
    if (mask && Number(mask[tokenIndex]) === 0) continue
    const tokenId = Number(ids[tokenIndex])
    if (!Number.isSafeInteger(tokenId) || tokenId < 0 || tokenId >= model.vocabularySize) continue
    const scale = model.scales[tokenId] ?? 0
    const offset = tokenId * model.dimensions
    for (let dimension = 0; dimension < model.dimensions; dimension += 1) {
      vector[dimension] =
        (vector[dimension] ?? 0) + (model.embeddings[offset + dimension] ?? 0) * scale
    }
    count += 1
  }
  if (count === 0) throw new Error('The static tokenizer produced no usable tokens.')
  return normalize(vector.map((value) => value / count))
}

export const getStaticEmbedding = async (
  text: string,
  modelName = DEFAULT_STATIC_EMBEDDING_MODEL,
) => {
  const model = await loadStaticEmbeddingModel(modelName)
  const tokenizer = await loadTokenizer(modelName)
  const tokenized = (await tokenizer(text)) as {
    input_ids: { tolist: () => Array<Array<number | bigint>> }
    attention_mask?: { tolist: () => Array<Array<number | bigint>> }
  }
  const ids = tokenized.input_ids.tolist()[0] ?? []
  const mask = tokenized.attention_mask?.tolist()[0]
  return poolStaticTokenEmbeddings(model, ids, mask)
}
