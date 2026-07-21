export type DocumentationPageDocument = {
  id: string
  path: string
  title: string
  url: string
  aliases: string[]
  chapters: string[]
  content?: string
  metadata?: Record<string, unknown>
}

export type LoadedDocumentationDocument = DocumentationPageDocument & {
  content: string
}

export type DocumentationDocumentLoader = () => Promise<{
  documents: LoadedDocumentationDocument[]
}>

export type DocumentationSearchOptions = {
  query: string
  mode: 'literal' | 'regex'
  limit: number
}

export type DocumentationSearchHit = {
  documentId: string
  path: string
  title: string
  url: string
  heading: string
  content: string
  score: number
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '')

const normalizeDocumentationAlias = (value: string) =>
  trimLeadingSlash(value)
    .replace(/^docs\//, '')
    .replace(/\.md$/, '')
    .replace(/\/+$/, '')

const stripOptionalFrontmatter = (content: string) =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)*/, '')

const maxSearchPatternLength = 256
const maxSearchSectionLength = 2400
const searchSectionOverlap = 250

const splitSearchSection = (content: string): string[] => {
  if (content.length <= maxSearchSectionLength) return [content]
  const sections: string[] = []
  let start = 0
  while (start < content.length) {
    const end = Math.min(content.length, start + maxSearchSectionLength)
    const section = content.slice(start, end).trim()
    if (section) sections.push(section)
    if (end === content.length) break
    start = end - searchSectionOverlap
  }
  return sections
}

const documentationSearchSections = (document: LoadedDocumentationDocument) => {
  const headingMatches = Array.from(document.content.matchAll(/^(#{1,6})\s+(.+)$/gm))
  const sections =
    headingMatches.length === 0
      ? [{ heading: document.title, start: 0, end: document.content.length }]
      : headingMatches.map((match, index) => ({
          heading: match[2]?.trim() || document.title,
          start: match.index ?? 0,
          end: headingMatches[index + 1]?.index ?? document.content.length,
        }))
  return sections.flatMap((section) =>
    splitSearchSection(document.content.slice(section.start, section.end)).map((content) => ({
      heading: section.heading,
      content,
    })),
  )
}

const createDocumentationMatcher = (options: DocumentationSearchOptions) => {
  const query = options.query.trim()
  if (!query) return () => 0
  if (query.length > maxSearchPatternLength) {
    throw new Error(
      `Documentation search query must not exceed ${maxSearchPatternLength} characters.`,
    )
  }
  if (options.mode === 'regex') {
    let pattern: RegExp
    try {
      pattern = new RegExp(query, 'i')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid documentation search regex: ${reason}`)
    }
    return (value: string) => (pattern.test(value) ? 1 : 0)
  }

  const normalizedQuery = query.toLowerCase()
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  return (value: string) => {
    const normalized = value.toLowerCase()
    if (normalized.includes(normalizedQuery)) return terms.length + 2
    return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0)
  }
}

export const searchDocumentation = (
  documents: readonly LoadedDocumentationDocument[],
  options: DocumentationSearchOptions,
): DocumentationSearchHit[] => {
  const match = createDocumentationMatcher(options)
  return documents
    .flatMap((document) =>
      documentationSearchSections(document).map(({ heading, content }) => {
        const metadata = `${document.title} ${document.path} ${document.aliases.join(' ')} ${heading}`
        const score = match(metadata) * 2 + match(content)
        return {
          documentId: document.id,
          path: document.path,
          title: document.title,
          url: document.url,
          heading,
          content,
          score,
        }
      }),
    )
    .filter((hit) => hit.score > 0)
    .toSorted((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(0, options.limit))
}

const firstMarkdownH1 = (content: string): string | undefined => {
  const lines = content.split(/\r?\n/)
  let fence = ''
  for (const [index, line] of lines.entries()) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      fence = fence ? '' : (fenceMatch[1] ?? '')
      continue
    }
    if (fence) continue

    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading?.[1]) return heading[1].trim()
    if (line.trim() && /^=+\s*$/.test(lines[index + 1] ?? '')) return line.trim()
  }
  return undefined
}

export const documentationLabelFromPathSegment = (segment: string) => {
  const label = segment
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[._ -]+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return label ? `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}` : segment
}

export const titleFromDocumentationPath = (path: string) =>
  documentationLabelFromPathSegment(path.split('/').filter(Boolean).at(-1) ?? path)

const isFolderIndex = (path: string) => /(?:^|\/)(?:index|readme)\.[^/]+$/i.test(path)

export const compareDocumentationPaths = (left: string, right: string) => {
  const indexDifference = Number(isFolderIndex(right)) - Number(isFolderIndex(left))
  return indexDifference || naturalCollator.compare(left, right)
}

export const documentationPathFromGlob = (globPath: string, rootMarker: string) => {
  const rootIndex = globPath.indexOf(rootMarker)
  const path = rootIndex >= 0 ? globPath.slice(rootIndex + rootMarker.length) : globPath
  return trimLeadingSlash(path)
}

export const parseDocumentationMarkdown = (content: string, path: string) => {
  const body = stripOptionalFrontmatter(content)
  return {
    title: firstMarkdownH1(body) ?? titleFromDocumentationPath(path),
    content: body,
  }
}

export const createDocumentationDocument = (input: {
  path: string
  url: string
  content: string
  aliases?: string[]
  chapters?: string[]
  metadata?: Record<string, unknown>
}): LoadedDocumentationDocument => {
  const parsed = parseDocumentationMarkdown(input.content, input.path)
  return {
    id: input.path,
    path: input.path,
    title: parsed.title,
    url: input.url,
    aliases: input.aliases ?? [],
    chapters: input.chapters ?? [],
    content: parsed.content,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

export const buildDocumentationDocumentsFromContentGlob = (
  contents: Record<string, string>,
  options: { rootMarker: string; baseUrl?: string },
): LoadedDocumentationDocument[] =>
  Object.entries(contents)
    .map(([globPath, content]) => {
      const path = documentationPathFromGlob(globPath, options.rootMarker)
      return createDocumentationDocument({
        path,
        url: `${options.baseUrl ?? '/docs/'}${path}`,
        content,
      })
    })
    .sort((left, right) => compareDocumentationPaths(left.path, right.path))

export const buildDocumentationDocumentsFromGlob = (
  urls: Record<string, string>,
  options: { rootMarker: string },
): DocumentationPageDocument[] =>
  Object.entries(urls)
    .map(([globPath, url]) => {
      const path = documentationPathFromGlob(globPath, options.rootMarker)
      return {
        id: path,
        path,
        title: titleFromDocumentationPath(path),
        url,
        aliases: [],
        chapters: [],
      }
    })
    .sort((left, right) => compareDocumentationPaths(left.path, right.path))

export const loadDocumentationDocumentContents = async (
  documents: readonly DocumentationPageDocument[],
): Promise<{ documents: LoadedDocumentationDocument[] }> => ({
  documents: await Promise.all(
    documents.map(async (document) => {
      if (document.content !== undefined) return { ...document, content: document.content }
      const response = await fetch(document.url, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(`Failed to load documentation ${document.path}: ${response.status}`)
      }
      return createDocumentationDocument({
        path: document.path,
        url: document.url,
        aliases: document.aliases,
        chapters: document.chapters,
        content: await response.text(),
      })
    }),
  ),
})

export const createDocumentationDocumentLoader =
  (documents: readonly DocumentationPageDocument[]): DocumentationDocumentLoader =>
  () =>
    loadDocumentationDocumentContents(documents)

export const resolveDocumentationDocumentId = (
  documents: readonly DocumentationPageDocument[],
  requestedPath: string,
) => {
  const requested = normalizeDocumentationAlias(requestedPath)
  const match = documents.find(
    (document) =>
      normalizeDocumentationAlias(document.id) === requested ||
      document.aliases.some((alias) => normalizeDocumentationAlias(alias) === requested),
  )
  return match?.id
}
