import {
  DEFAULT_STATIC_EMBEDDING_MODEL,
  loadStaticEmbeddingModelAssets,
  poolStaticTokenEmbeddings,
  type StaticEmbeddingModel,
} from '@taskyon/static-embeddings'
export {
  DEFAULT_STATIC_EMBEDDING_MODEL,
  poolStaticTokenEmbeddings,
} from '@taskyon/static-embeddings'
export type { StaticEmbeddingModel } from '@taskyon/static-embeddings'
import { loadTokenizer } from './nlp'

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

export const loadStaticEmbeddingModel = async (
  model = DEFAULT_STATIC_EMBEDDING_MODEL,
): Promise<StaticEmbeddingModel> => {
  const existing = loadedModels.get(model)
  if (existing) return await existing
  const loading = (async () => {
    const baseUrl = modelBaseUrl(model)
    return (await loadStaticEmbeddingModelAssets(baseUrl, readAsset)).model
  })()
  loadedModels.set(model, loading)
  try {
    return await loading
  } catch (error) {
    loadedModels.delete(model)
    throw error
  }
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
