export type ImportAliasMap = Record<string, string>

export const extractImportAliases = (source: string): ImportAliasMap => {
  const aliases: ImportAliasMap = {}
  const regex = /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm
  for (const match of source.matchAll(regex)) {
    const alias = String(match[1] || '').trim()
    const target = String(match[2] || '').trim()
    if (alias && target) aliases[alias] = target
  }
  return aliases
}

const expandImportAlias = (typeName: string, importAliases: ImportAliasMap): string[] => {
  const normalized = typeName.trim()
  if (!normalized) return []
  const first = normalized.split('.')[0] || ''
  const target = importAliases[first]
  if (!target) return [normalized]
  if (!normalized.includes('.')) return [normalized, target]
  const suffix = normalized.slice(first.length + 1)
  return [normalized, `${target}.${suffix}`]
}

export const buildTypeLookupCandidates = (
  typeName: string,
  classQualifiedName: string | undefined,
  importAliases: ImportAliasMap = {},
): string[] => {
  const normalized = typeName.trim()
  if (!normalized) return []
  const classParts = (classQualifiedName ?? '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  const packageParts = classParts.slice(0, -1)
  const baseCandidates = expandImportAlias(normalized, importAliases)
  const candidates: string[] = [...baseCandidates]
  for (const baseCandidate of baseCandidates) {
    for (let i = packageParts.length; i >= 1; i -= 1) {
      candidates.push(`${packageParts.slice(0, i).join('.')}.${baseCandidate}`)
    }
  }
  const isQualified = normalized.includes('.')
  if (!isQualified && !normalized.startsWith('Modelica.')) candidates.push(`Modelica.${normalized}`)
  for (let i = packageParts.length; i >= 1; i -= 1) {
    candidates.push(`${packageParts.slice(0, i).join('.')}.${normalized}`)
  }
  return Array.from(new Set(candidates))
}
