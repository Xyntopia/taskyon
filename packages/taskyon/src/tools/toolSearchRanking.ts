import type { ToolBase } from '../types/tools'

type SearchField = {
  value: string
  weight: number
}

const collectSchemaText = (value: unknown, parts: string[]) => {
  if (typeof value === 'string') {
    parts.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemaText(item, parts))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, child]) => {
    parts.push(key)
    collectSchemaText(child, parts)
  })
}

const buildSearchFields = (tool: ToolBase): SearchField[] => {
  const schemaText: string[] = []
  collectSchemaText(tool.parameters, schemaText)
  return [
    { value: tool.name, weight: 40 },
    { value: tool.description, weight: 20 },
    ...(tool.longDescription ? [{ value: tool.longDescription, weight: 12 }] : []),
    { value: schemaText.join(' '), weight: 8 },
  ]
}

const isSearchStopWord = (term: string) =>
  /^(?:a|an|and|are|as|at|be|by|for|from|how|i|in|is|it|me|of|on|or|please|the|this|to|use|what|when|where|which|who|with|you)$/.test(
    term,
  )

const splitSearchText = (value: string) =>
  value.split(/[^\p{L}\p{N}]+|(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u).filter(Boolean)

const normalizeTerms = (query: string) => [
  ...new Set(
    splitSearchText(query)
      .map((term) => term.toLocaleLowerCase())
      .filter((term) => !isSearchStopWord(term)),
  ),
]

const normalizeSearchToken = (term: string) =>
  term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term

const hasExactSearchTerm = (value: string, term: string) => {
  const normalizedTerm = normalizeSearchToken(term)
  const tokens = splitSearchText(value).map((token) =>
    normalizeSearchToken(token.toLocaleLowerCase()),
  )
  return tokens.includes(normalizedTerm)
}

const scoreTool = (tool: ToolBase, terms: readonly string[], exactTermMatches: boolean) => {
  if (terms.length === 0) return { score: 0, matchedTermCount: 0 }
  const fields = buildSearchFields(tool)
  let matchedTermCount = 0
  const score = terms.reduce((total, term) => {
    const matchingFields = fields.filter((field) =>
      exactTermMatches
        ? hasExactSearchTerm(field.value, term)
        : field.value.toLocaleLowerCase().includes(term),
    )
    if (matchingFields.length === 0) return total
    matchedTermCount += 1
    const strongestMatch = Math.max(...matchingFields.map((field) => field.weight))
    return total + strongestMatch + matchingFields.length
  }, 0)
  return { score, matchedTermCount }
}

export const rankToolDefinitions = (
  tools: readonly ToolBase[],
  query: string,
  limit: number,
  options?: { minimumMatchedTerms?: number; exactTermMatches?: boolean },
): ToolBase[] => {
  const terms = normalizeTerms(query)
  const minimumMatchedTerms = Math.max(1, options?.minimumMatchedTerms ?? 1)
  if (terms.length === 0) {
    return minimumMatchedTerms > 1 ? [] : tools.slice(0, Math.max(1, limit))
  }

  return tools
    .map((tool) => ({
      tool,
      ...scoreTool(tool, terms, options?.exactTermMatches ?? false),
    }))
    .filter(
      ({ score, matchedTermCount }) =>
        score > 0 && matchedTermCount >= Math.min(minimumMatchedTerms, terms.length),
    )
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, Math.max(1, limit))
    .map(({ tool }) => tool)
}
