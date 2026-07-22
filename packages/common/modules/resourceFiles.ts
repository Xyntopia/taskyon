export type DocumentationManifestEntry = string | DocumentationChapter

export type DocumentationChapter = Record<string, DocumentationManifestEntry[]>

export type DocumentationManifest = {
  internal: DocumentationManifestEntry[]
  external: DocumentationManifestEntry[]
}

export type LoadedResourceFile = {
  url: string
  file: File
  path?: string
}

export type ResourceFilesLoader = (source: string) => AsyncIterable<LoadedResourceFile>

export type DocumentationManifestFile = LoadedResourceFile & {
  source: string
  cache: 'internal' | 'external'
  chapters: string[]
}

export type DocumentationManifestLoadError = {
  source: string
  message: string
}

const parseDocumentationManifestEntries = (value: unknown): DocumentationManifestEntry[] => {
  if (!Array.isArray(value)) throw new Error('Documentation manifest sections must be arrays.')
  return value.map((entry) => {
    if (typeof entry === 'string') return entry
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Documentation chapter entries must be objects.')
    }
    const chapter = Object.entries(entry)
    if (chapter.length !== 1) {
      throw new Error('Each documentation chapter must contain exactly one named entry.')
    }
    const [title, children] = chapter[0]!
    return { [title]: parseDocumentationManifestEntries(children) }
  })
}

export const parseDocumentationManifest = (value: unknown): DocumentationManifest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('internal' in value) ||
    !('external' in value)
  ) {
    throw new Error('Documentation manifest must contain internal and external sections.')
  }
  return {
    internal: parseDocumentationManifestEntries(value.internal),
    external: parseDocumentationManifestEntries(value.external),
  }
}

const isDocumentationSource = (entry: DocumentationManifestEntry): entry is string =>
  typeof entry === 'string'

const filterDocumentationManifestEntries = (
  entries: DocumentationManifestEntry[],
  predicate: (source: string) => boolean,
): DocumentationManifestEntry[] =>
  entries.flatMap((entry): DocumentationManifestEntry[] => {
    if (isDocumentationSource(entry)) return predicate(entry) ? [entry] : []
    return Object.entries(entry).flatMap(([title, children]) => {
      const filtered = filterDocumentationManifestEntries(children, predicate)
      return filtered.length > 0 ? [{ [title]: filtered }] : []
    })
  })

export const filterDocumentationManifestSources = (
  manifest: DocumentationManifest,
  predicate: (source: string) => boolean,
): DocumentationManifest => ({
  internal: filterDocumentationManifestEntries(manifest.internal, predicate),
  external: filterDocumentationManifestEntries(manifest.external, predicate),
})

const flattenDocumentationManifestEntries = (
  entries: DocumentationManifestEntry[],
  cache: 'internal' | 'external',
  chapters: string[] = [],
): Array<{
  source: string
  cache: 'internal' | 'external'
  chapters: string[]
}> =>
  entries.flatMap((entry) => {
    if (isDocumentationSource(entry)) return [{ source: entry, cache, chapters }]

    const chapter = Object.entries(entry)
    if (chapter.length !== 1) {
      throw new Error('Each documentation chapter must contain exactly one named entry.')
    }
    const [title, children] = chapter[0] ?? []
    if (!title || !Array.isArray(children)) {
      throw new Error('Documentation chapter entries must map a title to an array.')
    }
    return flattenDocumentationManifestEntries(children, cache, [...chapters, title])
  })

export const flattenDocumentationManifestSources = (manifest: DocumentationManifest) => [
  ...flattenDocumentationManifestEntries(manifest.internal, 'internal'),
  ...flattenDocumentationManifestEntries(manifest.external, 'external'),
]

export const loadHttpResourceFiles: ResourceFilesLoader = async function* (source) {
  const url = new URL(source)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`HTTP resource loader does not support ${url.protocol}`)
  }
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Failed to load ${source}: ${response.status}`)
  const blob = await response.blob()
  const name = url.pathname.split('/').filter(Boolean).at(-1) ?? 'resource'
  yield {
    url: response.url || source,
    file: new File([blob], name, {
      type: blob.type || response.headers.get('content-type') || 'application/octet-stream',
    }),
  }
}

export const loadDocumentationManifestFiles = async (
  manifest: DocumentationManifest,
  loadFiles: ResourceFilesLoader,
): Promise<{
  files: DocumentationManifestFile[]
  errors: DocumentationManifestLoadError[]
}> => {
  const files: DocumentationManifestFile[] = []
  const errors: DocumentationManifestLoadError[] = []
  let sources: ReturnType<typeof flattenDocumentationManifestSources>
  try {
    sources = flattenDocumentationManifestSources(manifest)
  } catch (error) {
    return {
      files,
      errors: [
        {
          source: 'manifest',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }

  for (const { source: entry, cache, chapters } of sources) {
    const source = entry
    try {
      const loadedFiles: LoadedResourceFile[] = []
      for await (const loaded of loadFiles(source)) {
        loadedFiles.push(loaded)
      }
      for (const loaded of loadedFiles) {
        files.push({
          ...loaded,
          source,
          cache,
          chapters,
        })
      }
    } catch (error) {
      errors.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { files, errors }
}
