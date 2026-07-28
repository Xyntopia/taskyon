import { rankSearchDocuments, searchIndexSignature } from '../utils/searchEngine'
import { createPgLiteSearchIndexBackend } from '../api/searchProtocol'
import { getInMemoryDatabase } from '../utils/pglite.api'
import { poolStaticTokenEmbeddings } from '../utils/staticEmbedding'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testHybridSearchRanksMultilingualLexicalFallback = () => {
  const results = rankSearchDocuments({
    query: 'schnelle Batteriesimulation',
    documents: [
      { id: 'unrelated', text: 'Weather forecast for tomorrow' },
      { id: 'match', text: 'Schnelle Batteriesimulation mit einem Surrogatmodell' },
    ],
    limit: 2,
  })
  assert(
    results[0]?.id === 'match',
    'Expected multilingual lexical fallback to rank the match first',
  )
  assert(results[0]!.lexicalScore > 0, 'Expected the lexical feature to contribute to ranking')
}

testHybridSearchRanksMultilingualLexicalFallback.description =
  'Hybrid task search remains useful for multilingual text when semantic vectorization is unavailable.'

export const testSearchIndexSignatureSeparatesVectorizers = () => {
  const staticSignature = searchIndexSignature({
    vectorizer: 'static-multilingual',
    model: 'static-model',
    dimensions: 256,
  })
  const transformerSignature = searchIndexSignature({
    vectorizer: 'transformer-minilm',
    model: 'minilm',
    dimensions: 384,
  })
  assert(staticSignature !== transformerSignature, 'Expected vectorizer indexes to be isolated')
}

testSearchIndexSignatureSeparatesVectorizers.description =
  'Search index signatures isolate incompatible vector dimensions and model presets.'

export const testStaticEmbeddingPoolsBigIntTokenIds = () => {
  const vector = poolStaticTokenEmbeddings(
    {
      dimensions: 2,
      vocabularySize: 2,
      embeddings: new Int8Array([127, 0, 0, 127]),
      scales: new Float32Array([1 / 127, 1 / 127]),
    },
    [0n, 1n],
    [1n, 1n],
  )
  assert(vector.length === 2, 'Expected the configured embedding dimensions')
  assert(vector.every(Number.isFinite), 'Expected finite pooled values for BigInt token IDs')
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  assert(Math.abs(magnitude - 1) < 1e-6, 'Expected a normalized static embedding')
}

testStaticEmbeddingPoolsBigIntTokenIds.description =
  'Static embeddings accept the BigInt token IDs returned by Transformers.js.'

export const testPgLiteSearchIndexRestoresPrecomputedVectors = async () => {
  const backend = createPgLiteSearchIndexBackend(
    await getInMemoryDatabase(`search-diagnostic-${Date.now()}`),
    'searchDiagnostic',
  )
  await backend.upsertMany([
    {
      id: 'taskyon',
      text: 'Taskyon agent task search',
      vector: Array.from({ length: 256 }, (_, index) => (index === 0 ? 1 : 0)),
    },
  ])
  const snapshot = await backend.snapshot()
  assert(snapshot[0]?.vector?.length === 256, 'Expected persisted vector sidecar data')
}

testPgLiteSearchIndexRestoresPrecomputedVectors.description =
  'The local PGlite search backend restores precomputed vectors without invoking a model.'
