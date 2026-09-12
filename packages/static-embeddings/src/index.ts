import { z } from 'zod'

export const DEFAULT_STATIC_EMBEDDING_MODEL =
  'taskyon/static-similarity-mrl-multilingual-v1-d256-int8'

export type StaticEmbeddingModel = {
  dimensions: number
  vocabularySize: number
  embeddings: Int8Array
  scales: Float32Array
}

export async function loadStaticEmbeddingModelAssets(
  baseUrl: string,
  readAsset: (url: string) => Promise<ArrayBuffer>,
) {
  const asset = z.object({ file: z.string(), sha256: z.string() })
  const manifest = z
    .object({
      formatVersion: z.literal(1),
      dimensions: z.number().int().positive(),
      vocabularySize: z.number().int().positive(),
      embeddings: asset,
      scales: asset,
    })
    .parse(
      JSON.parse(new TextDecoder().decode(await readAsset(`${baseUrl}/static-embedding.json`))),
    )
  const loadAsset = async (entry: { file: string; sha256: string }) => {
    if (!/^[\w.-]+$/.test(entry.file)) throw new Error('Invalid model asset filename')
    const data = await readAsset(`${baseUrl}/${entry.file}`)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const actual = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    if (actual !== entry.sha256.replace(/^sha256:/, '').toLowerCase())
      throw new Error('Model asset checksum mismatch')
    return data
  }
  const [embeddingsBuffer, scalesBuffer] = await Promise.all([
    loadAsset(manifest.embeddings),
    loadAsset(manifest.scales),
  ])
  const embeddings = new Int8Array(embeddingsBuffer)
  const scales = new Float32Array(scalesBuffer)
  if (
    embeddings.length !== manifest.vocabularySize * manifest.dimensions ||
    scales.length !== manifest.vocabularySize
  ) {
    throw new Error('Static embedding matrix size does not match its manifest')
  }
  return {
    model: {
      dimensions: manifest.dimensions,
      vocabularySize: manifest.vocabularySize,
      embeddings,
      scales,
    },
    manifest,
  }
}

export function poolStaticTokenEmbeddings(
  model: StaticEmbeddingModel,
  ids: Array<number | bigint>,
  mask?: Array<number | bigint>,
) {
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
  const mean = vector.map((value) => value / count)
  const magnitude = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0))
  return magnitude === 0 ? mean : mean.map((value) => value / magnitude)
}
