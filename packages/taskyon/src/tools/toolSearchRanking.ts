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

const normalizeTerms = (query: string) =>
  query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0)

const scoreTool = (tool: ToolBase, terms: readonly string[]) => {
  if (terms.length === 0) return 0
  const fields = buildSearchFields(tool).map((field) => ({
    ...field,
    value: field.value.toLocaleLowerCase(),
  }))
  const score = terms.reduce((total, term) => {
    const matchingFields = fields.filter((field) => field.value.includes(term))
    if (matchingFields.length === 0) return total
    const strongestMatch = Math.max(...matchingFields.map((field) => field.weight))
    return total + strongestMatch + matchingFields.length
  }, 0)
  return score
}

export const rankToolDefinitions = (
  tools: readonly ToolBase[],
  query: string,
  limit: number,
): ToolBase[] => {
  const terms = normalizeTerms(query)
  if (terms.length === 0) return tools.slice(0, Math.max(1, limit))

  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, Math.max(1, limit))
    .map(({ tool }) => tool)
}
