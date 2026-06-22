import { strFromU8 } from 'fflate'

export type LazyModelicaClassTreeNode = {
  name: string
  qualified_name: string
  class_type: string
  partial: boolean
  children: LazyModelicaClassTreeNode[]
}

export type LazyModelicaLibraryIndex = {
  totalClasses: number
  fileCount: number
  classes: LazyModelicaClassTreeNode[]
  classToUris: Record<string, string[]>
  uriToClasses: Record<string, string[]>
  sourceRootUris: string[]
}

export type LazyModelicaLibraryArchive = {
  sources: Record<string, string>
  index: LazyModelicaLibraryIndex
}

export type LazyModelicaLibraryByteArchive = {
  sources: Record<string, Uint8Array>
  index: LazyModelicaLibraryIndex
}

type ClassDeclaration = {
  name: string
  classType: string
  partial: boolean
}

type LazyClassEntry = {
  name: string
  qualifiedName: string
  classType: string
  partial: boolean
  uri: string
}

type OpenClass = {
  name: string
  qualifiedName: string
}

type MutableTreeNode = {
  name: string
  qualifiedName: string
  classType: string
  partial: boolean
  children: Map<string, MutableTreeNode>
}

const CLASS_KEYWORDS = new Set([
  'block',
  'class',
  'connector',
  'function',
  'model',
  'package',
  'record',
  'type',
])

export function normalizeModelicaLibraryEntryPath(path: string): string {
  const parts = String(path || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) {
    return parts.slice(1).join('/')
  }
  if (parts.length > 0) {
    parts[0] = parts[0]!.replace(/[\s-][\d.]+$/, '')
  }
  return parts.join('/')
}

export function buildLazyModelicaLibraryArchive(
  archive: Record<string, Uint8Array>,
): LazyModelicaLibraryArchive {
  const sources: Record<string, string> = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    const normalizedPath = normalizeArchiveSourcePath(rawPath)
    if (!normalizedPath) continue
    sources[normalizedPath] = strFromU8(content)
  }
  return {
    sources,
    index: buildLazyModelicaLibraryIndex(sources),
  }
}

export function buildLazyModelicaLibraryByteArchive(
  archive: Record<string, Uint8Array>,
): LazyModelicaLibraryByteArchive {
  const sources: Record<string, Uint8Array> = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    const normalizedPath = normalizeArchiveSourcePath(rawPath)
    if (!normalizedPath) continue
    sources[normalizedPath] = content
  }
  return {
    sources,
    index: buildLazyModelicaLibraryIndexFromArchiveBytes(sources),
  }
}

export function buildLazyModelicaLibraryIndex(
  sources: Record<string, string>,
): LazyModelicaLibraryIndex {
  const entries = Object.entries(sources).flatMap(([uri, source]) =>
    scanModelicaClassEntries(uri, source),
  )
  return buildLazyModelicaLibraryIndexFromEntries(entries, Object.keys(sources))
}

export function buildLazyModelicaLibraryIndexFromArchiveBytes(
  sources: Record<string, Uint8Array>,
): LazyModelicaLibraryIndex {
  const entries = Object.entries(sources).flatMap(([uri, content]) => {
    const inferred = inferClassEntryFromUri(uri)
    const scanned = uri.endsWith('/package.mo')
      ? scanModelicaClassEntries(uri, strFromU8(content))
      : []
    return inferred ? [inferred, ...scanned] : scanned
  })
  return buildLazyModelicaLibraryIndexFromEntries(dedupeClassEntries(entries), Object.keys(sources))
}

function buildLazyModelicaLibraryIndexFromEntries(
  entries: LazyClassEntry[],
  sourceRootUris: string[],
): LazyModelicaLibraryIndex {
  const classToUris: Record<string, string[]> = {}
  const uriToClasses: Record<string, string[]> = {}
  for (const entry of entries) {
    classToUris[entry.qualifiedName] = appendUnique(
      classToUris[entry.qualifiedName] ?? [],
      entry.uri,
    )
    uriToClasses[entry.uri] = appendUnique(uriToClasses[entry.uri] ?? [], entry.qualifiedName)
  }

  return {
    totalClasses: entries.length,
    fileCount: sourceRootUris.length,
    classes: buildClassTree(entries),
    classToUris,
    uriToClasses,
    sourceRootUris: sourceRootUris.slice().sort((lhs, rhs) => lhs.localeCompare(rhs)),
  }
}

export function selectLazyModelicaSourceSubset(
  sources: Record<string, string>,
  index: LazyModelicaLibraryIndex | null,
  qualifiedNames: string[],
  existingUris: Iterable<string> = [],
): Record<string, string> {
  return Object.fromEntries(
    selectLazyModelicaSourceUris(index, qualifiedNames, Object.keys(sources), existingUris)
      .sort((lhs, rhs) => lhs.localeCompare(rhs))
      .map((uri) => [uri, sources[uri] ?? '']),
  )
}

export function selectLazyModelicaSourceUris(
  index: LazyModelicaLibraryIndex | null,
  qualifiedNames: string[],
  availableUris: Iterable<string>,
  existingUris: Iterable<string> = [],
): string[] {
  const available = new Set(availableUris)
  const selected = new Set<string>()
  for (const uri of existingUris) {
    if (available.has(uri)) selected.add(uri)
  }
  for (const qualifiedName of qualifiedNames) {
    for (const uri of sourceUrisForQualifiedName(index, qualifiedName)) {
      if (available.has(uri)) selected.add(uri)
      addAncestorPackageUris(selected, available, uri)
    }
  }
  return Array.from(selected)
}

export function sourceUrisForQualifiedName(
  index: LazyModelicaLibraryIndex | null,
  qualifiedName: string,
): string[] {
  if (!index) return []
  const normalized = normalizeQualifiedName(qualifiedName)
  if (!normalized) return []
  const direct = index.classToUris[normalized] ?? []
  if (direct.length > 0) return direct

  const parts = normalized.split('.')
  for (let count = parts.length - 1; count > 0; count--) {
    const parent = parts.slice(0, count).join('.')
    const parentUris = index.classToUris[parent] ?? []
    if (parentUris.length > 0) return parentUris
  }
  return []
}

function normalizeArchiveSourcePath(rawPath: string): string {
  const lowerPath = rawPath.toLowerCase()
  if (!lowerPath.endsWith('.mo')) return ''
  if (rawPath.includes('Test') || rawPath.includes('Obsolete')) return ''
  return normalizeModelicaLibraryEntryPath(rawPath)
}

function inferClassEntryFromUri(uri: string): LazyClassEntry | null {
  const parts = uri.replace(/\.mo$/i, '').split('/').filter(Boolean)
  if (parts.length === 0) return null
  const isPackageFile = parts[parts.length - 1] === 'package'
  const classParts = isPackageFile ? parts.slice(0, -1) : parts
  const name = classParts[classParts.length - 1]
  if (!name) return null
  return {
    name,
    qualifiedName: classParts.join('.'),
    classType: isPackageFile ? 'package' : 'class',
    partial: false,
    uri,
  }
}

function dedupeClassEntries(entries: LazyClassEntry[]): LazyClassEntry[] {
  const seen = new Set<string>()
  const deduped: LazyClassEntry[] = []
  for (const entry of entries) {
    const key = `${entry.qualifiedName}\n${entry.uri}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

function scanModelicaClassEntries(uri: string, source: string): LazyClassEntry[] {
  const tokens = tokenizeModelicaForDeclarations(source)
  const within = parseWithin(tokens)
  const openClasses: OpenClass[] = []
  const entries: LazyClassEntry[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === 'end') {
      const endName = tokens[index + 1]
      if (endName) closeOpenClass(openClasses, endName)
      continue
    }

    const declaration = readClassDeclaration(tokens, index)
    if (!declaration) continue

    const qualifiedName = qualifiedChildName(within, openClasses, declaration.name)
    entries.push({
      name: declaration.name,
      qualifiedName,
      classType: declaration.classType,
      partial: declaration.partial,
      uri,
    })
    openClasses.push({
      name: declaration.name,
      qualifiedName,
    })
  }

  return entries
}

function tokenizeModelicaForDeclarations(source: string): string[] {
  const tokens: string[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }
    if (char === '"') {
      index = skipQuoted(source, index, '"')
      continue
    }
    if (char === "'") {
      const quoted = readQuotedIdentifier(source, index)
      tokens.push(quoted.value)
      index = quoted.nextIndex
      continue
    }
    if (isIdentifierStart(char)) {
      const start = index
      index += 1
      while (index < source.length && isIdentifierPart(source[index])) index += 1
      tokens.push(source.slice(start, index))
      continue
    }
    if (char === '.' || char === ';') tokens.push(char)
    index += 1
  }
  return tokens
}

function skipQuoted(source: string, start: number, quote: '"' | "'"): number {
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    index += 1
  }
  return source.length
}

function readQuotedIdentifier(source: string, start: number): { value: string; nextIndex: number } {
  let value = ''
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      const next = source[index + 1]
      if (next) value += next
      index += 2
      continue
    }
    if (source[index] === "'") {
      return { value, nextIndex: index + 1 }
    }
    value += source[index]
    index += 1
  }
  return { value, nextIndex: source.length }
}

function parseWithin(tokens: string[]): string[] {
  const withinIndex = tokens.findIndex((token) => token === 'within')
  if (withinIndex < 0) return []
  const parts: string[] = []
  for (let index = withinIndex + 1; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === ';') break
    if (token === '.') continue
    if (isIdentifierLike(token)) parts.push(token)
  }
  return parts
}

function readClassDeclaration(tokens: string[], index: number): ClassDeclaration | null {
  const token = tokens[index]
  const partial = token === 'partial'
  const keywordIndex = partial ? index + 1 : index
  const keyword = tokens[keywordIndex]

  if (keyword === 'operator') {
    return readOperatorDeclaration(tokens, keywordIndex, partial)
  }
  if (!CLASS_KEYWORDS.has(keyword ?? '')) return null
  const name = declarationNameAfterKeyword(tokens, keywordIndex)
  return name ? { name, classType: keyword!, partial } : null
}

function readOperatorDeclaration(
  tokens: string[],
  keywordIndex: number,
  partial: boolean,
): ClassDeclaration | null {
  const next = tokens[keywordIndex + 1]
  if (next === 'record') {
    const name = tokens[keywordIndex + 2]
    return name ? { name, classType: 'record', partial } : null
  }
  if (next === 'function') {
    const name = tokens[keywordIndex + 2]
    return name ? { name, classType: 'function', partial } : null
  }
  return next ? { name: next, classType: 'operator', partial } : null
}

function declarationNameAfterKeyword(tokens: string[], keywordIndex: number): string | null {
  const next = tokens[keywordIndex + 1]
  if (!next) return null
  if (next === 'operator') return tokens[keywordIndex + 2] ?? null
  return next
}

function qualifiedChildName(within: string[], openClasses: OpenClass[], className: string): string {
  const parent = openClasses[openClasses.length - 1]
  if (parent) return `${parent.qualifiedName}.${className}`
  return within.length > 0 ? `${within.join('.')}.${className}` : className
}

function closeOpenClass(openClasses: OpenClass[], endName: string): void {
  for (let index = openClasses.length - 1; index >= 0; index--) {
    if (openClasses[index]?.name === endName) {
      openClasses.splice(index)
      return
    }
  }
}

function buildClassTree(entries: LazyClassEntry[]): LazyModelicaClassTreeNode[] {
  const roots = new Map<string, MutableTreeNode>()
  for (const entry of entries) insertTreeEntry(roots, entry)
  return Array.from(roots.values()).map(freezeTreeNode)
}

function insertTreeEntry(roots: Map<string, MutableTreeNode>, entry: LazyClassEntry): void {
  let children = roots
  const parts = entry.qualifiedName.split('.')
  let prefix = ''
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    prefix = prefix ? `${prefix}.${part}` : part
    const isLeaf = index + 1 === parts.length
    const node =
      children.get(part) ??
      createMutableTreeNode(part, prefix, isLeaf ? entry.classType : 'package', false)
    if (isLeaf) {
      node.classType = entry.classType
      node.partial = entry.partial
    }
    children.set(part, node)
    children = node.children
  }
}

function createMutableTreeNode(
  name: string,
  qualifiedName: string,
  classType: string,
  partial: boolean,
): MutableTreeNode {
  return {
    name,
    qualifiedName,
    classType,
    partial,
    children: new Map(),
  }
}

function freezeTreeNode(node: MutableTreeNode): LazyModelicaClassTreeNode {
  return {
    name: node.name,
    qualified_name: node.qualifiedName,
    class_type: node.classType,
    partial: node.partial,
    children: Array.from(node.children.values()).map(freezeTreeNode),
  }
}

function addAncestorPackageUris(
  selected: Set<string>,
  availableUris: ReadonlySet<string>,
  uri: string,
): void {
  const parts = uri.split('/').filter(Boolean)
  for (let count = 1; count < parts.length; count++) {
    const packageUri = `${parts.slice(0, count).join('/')}/package.mo`
    if (availableUris.has(packageUri)) selected.add(packageUri)
  }
}

function normalizeQualifiedName(qualifiedName: string): string {
  return String(qualifiedName || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.')
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value]
}

function isIdentifierStart(char: string | undefined): boolean {
  return !!char && /[A-Za-z_]/.test(char)
}

function isIdentifierPart(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_]/.test(char)
}

function isIdentifierLike(token: string | undefined): token is string {
  return !!token && token !== '.' && token !== ';'
}
