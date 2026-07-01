import * as sw from 'stopword'

export type TextRankOptions = {
  maxTerms?: number
  windowSize?: number
  damping?: number
  maxIterations?: number
  convergenceThreshold?: number
  stopWords?: readonly string[]
}

export type RankedTextTerm = {
  term: string
  display: string
  score: number
  firstIndex: number
}

type Token = {
  term: string
  display: string
  index: number
}

const DEFAULT_MAX_TERMS = 8
const DEFAULT_WINDOW_SIZE = 2
const DEFAULT_DAMPING = 0.85
const DEFAULT_MAX_ITERATIONS = 100
const DEFAULT_CONVERGENCE_THRESHOLD = 0.0001
export const DEFAULT_KEYWORD_STOP_WORDS = sw.eng

const stripMarkdownCode = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`]*`/g, ' ')

const codeSignalCount = (line: string) => {
  const keywords =
    line.match(
      /\b(import|export|const|let|var|function|class|interface|type|return|if|else|for|while|async|await|def)\b/g,
    )?.length ?? 0
  const symbols = line.match(/[{};=<>()[\]]|=>/g)?.length ?? 0
  return keywords + symbols
}

const isCodeLikeLine = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/^(\s{4,}|\t)/.test(line)) return true
  const signals = codeSignalCount(trimmed)
  return signals >= 3 || signals / trimmed.length > 0.12
}

const stripSourceLikeText = (text: string) =>
  stripMarkdownCode(text)
    .split('\n')
    .filter((line) => !isCodeLikeLine(line))
    .join('\n')

const tokenize = (text: string): Token[] =>
  Array.from(stripSourceLikeText(text).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu))
    .map((match, index) => {
      const display = match[0] ?? ''
      return {
        display,
        term: display.toLowerCase(),
        index,
      }
    })
    .filter((token) => token.term.length > 1)

const uniqueStopWords = (customStopWords: readonly string[] | undefined) =>
  new Set([...(customStopWords ?? DEFAULT_KEYWORD_STOP_WORDS)].map((word) => word.toLowerCase()))

const removeStopWords = (tokens: Token[], stopWords: Set<string>) =>
  tokens.filter((token) => !stopWords.has(token.term))

const addEdge = (graph: Map<string, Map<string, number>>, a: string, b: string) => {
  if (a === b) return graph
  const edges = graph.get(a) ?? new Map<string, number>()
  edges.set(b, (edges.get(b) ?? 0) + 1)
  graph.set(a, edges)
  return graph
}

const buildGraph = (tokens: readonly Token[], windowSize: number) =>
  tokens.reduce((graph, token, index) => {
    const end = Math.min(index + windowSize, tokens.length - 1)
    for (let nextIndex = index + 1; nextIndex <= end; nextIndex += 1) {
      const next = tokens[nextIndex]
      if (next) {
        addEdge(graph, token.term, next.term)
        addEdge(graph, next.term, token.term)
      }
    }
    if (!graph.has(token.term)) graph.set(token.term, new Map())
    return graph
  }, new Map<string, Map<string, number>>())

const edgeWeightSum = (edges: Map<string, number>) =>
  Array.from(edges.values()).reduce((sum, weight) => sum + weight, 0)

const pageRankStep = (
  graph: Map<string, Map<string, number>>,
  scores: Map<string, number>,
  damping: number,
) =>
  Array.from(graph.keys()).reduce((nextScores, term) => {
    const rank = Array.from(graph.entries()).reduce((sum, [source, edges]) => {
      const weight = edges.get(term)
      if (!weight) return sum
      const sourceWeight = edgeWeightSum(edges)
      if (sourceWeight <= 0) return sum
      return sum + ((scores.get(source) ?? 1) * weight) / sourceWeight
    }, 0)
    nextScores.set(term, 1 - damping + damping * rank)
    return nextScores
  }, new Map<string, number>())

const scoreDelta = (left: Map<string, number>, right: Map<string, number>) =>
  Array.from(left.entries()).reduce(
    (sum, [term, score]) => sum + Math.abs(score - (right.get(term) ?? 0)),
    0,
  )

const runPageRank = (
  graph: Map<string, Map<string, number>>,
  damping: number,
  maxIterations: number,
  convergenceThreshold: number,
) => {
  let scores = new Map(Array.from(graph.keys()).map((term) => [term, 1]))
  for (let i = 0; i < maxIterations; i += 1) {
    const nextScores = pageRankStep(graph, scores, damping)
    if (scoreDelta(scores, nextScores) < convergenceThreshold) return nextScores
    scores = nextScores
  }
  return scores
}

const termMetadata = (tokens: readonly Token[]) =>
  tokens.reduce((metadata, token) => {
    if (!metadata.has(token.term)) {
      metadata.set(token.term, { display: token.display, firstIndex: token.index })
    }
    return metadata
  }, new Map<string, { display: string; firstIndex: number }>())

export function textRankTerms(text: string, options: TextRankOptions = {}): RankedTextTerm[] {
  const maxTerms = Math.max(1, options.maxTerms ?? DEFAULT_MAX_TERMS)
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE)
  const damping = options.damping ?? DEFAULT_DAMPING
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_ITERATIONS)
  const convergenceThreshold = options.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD
  const tokens = removeStopWords(tokenize(text), uniqueStopWords(options.stopWords))
  if (tokens.length === 0) return []

  const graph = buildGraph(tokens, windowSize)
  const scores = runPageRank(graph, damping, maxIterations, convergenceThreshold)
  const metadata = termMetadata(tokens)

  return Array.from(scores.entries())
    .map(([term, score]) => {
      const meta = metadata.get(term)
      return meta ? { term, score, display: meta.display, firstIndex: meta.firstIndex } : undefined
    })
    .filter((term): term is RankedTextTerm => term !== undefined)
    .sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex)
    .slice(0, maxTerms)
}
