import { textRankTerms } from './textRank'

export const SEARCH_FEATURE_SCHEMA_VERSION = 1

export type SearchVectorizerPreset = 'static-multilingual' | 'transformer-minilm'

export type SearchDocument = {
  id: string
  text: string
  vector?: readonly number[]
  keywords?: readonly string[]
  createdAt?: string
  metadata?: Readonly<Record<string, string | number | boolean>>
}

export type SearchResult = {
  id: string
  score: number
  semanticScore: number
  lexicalScore: number
  keywordScore: number
}

const words = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []

const keywordSet = (document: SearchDocument) =>
  new Set(
    (
      document.keywords ?? textRankTerms(document.text, { maxTerms: 8 }).map(({ term }) => term)
    ).map((keyword) => keyword.toLocaleLowerCase()),
  )

const cosine = (left: readonly number[], right: readonly number[]) => {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    dot += l * r
    leftMagnitude += l * l
    rightMagnitude += r * r
  }
  const denominator = Math.sqrt(leftMagnitude * rightMagnitude)
  return denominator === 0 ? 0 : Math.max(0, dot / denominator)
}

const lexicalScore = (queryWords: readonly string[], text: string) => {
  if (queryWords.length === 0) return 0
  const documentWords = new Set(words(text))
  const matches = queryWords.filter((word) => documentWords.has(word)).length
  const coverage = matches / queryWords.length
  const lengthPenalty = 1 / Math.sqrt(Math.max(1, documentWords.size / queryWords.length))
  return Math.min(1, coverage * lengthPenalty)
}

const keywordScore = (queryKeywords: ReadonlySet<string>, document: SearchDocument) => {
  if (queryKeywords.size === 0) return 0
  const documentKeywords = keywordSet(document)
  let matches = 0
  for (const keyword of queryKeywords) if (documentKeywords.has(keyword)) matches += 1
  return matches / queryKeywords.size
}

export const rankSearchDocuments = (args: {
  query: string
  queryVector?: readonly number[]
  documents: readonly SearchDocument[]
  limit: number
}): SearchResult[] => {
  const queryWords = words(args.query)
  const queryKeywords = new Set(
    textRankTerms(args.query, { maxTerms: 8 }).map(({ term }) => term.toLocaleLowerCase()),
  )
  const semanticAvailable = Boolean(args.queryVector)
  return args.documents
    .map((document) => {
      const semanticScore =
        args.queryVector && document.vector ? cosine(args.queryVector, document.vector) : 0
      const lexical = lexicalScore(queryWords, document.text)
      const keywords = keywordScore(queryKeywords, document)
      const score = semanticAvailable
        ? semanticScore * 0.8 + lexical * 0.15 + keywords * 0.05
        : lexical * 0.75 + keywords * 0.25
      return {
        id: document.id,
        score,
        semanticScore,
        lexicalScore: lexical,
        keywordScore: keywords,
        createdAt: document.createdAt,
      }
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.createdAt ?? '').localeCompare(left.createdAt ?? '') ||
        left.id.localeCompare(right.id),
    )
    .slice(0, Math.max(0, args.limit))
    .map(({ id, score, semanticScore, lexicalScore, keywordScore }) => ({
      id,
      score,
      semanticScore,
      lexicalScore,
      keywordScore,
    }))
}

export const searchIndexSignature = (args: {
  vectorizer: SearchVectorizerPreset
  model: string
  dimensions: number
  modelChecksum?: string
}) =>
  [
    `features-${SEARCH_FEATURE_SCHEMA_VERSION}`,
    args.vectorizer,
    args.model,
    args.dimensions,
    args.modelChecksum ?? 'unversioned',
  ].join(':')
