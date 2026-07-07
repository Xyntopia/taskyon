export type DocumentationPageDocument = {
  id: string
  path: string
  title: string
  url: string
  content?: string
  metadata?: Record<string, unknown>
}

export type LoadedDocumentationDocument = DocumentationPageDocument & {
  content: string
}

export type DocumentationDocumentLoader = () => Promise<{
  documents: LoadedDocumentationDocument[]
}>

const trimLeadingSlash = (value: string) => value.replace(/^\//, '')

export const titleFromDocumentationPath = (path: string) =>
  path.split('/').pop()?.replace(/\.md$/, '').replace(/[_-]+/g, ' ') || path

export const documentationPathFromGlob = (globPath: string, rootMarker: string) => {
  const rootIndex = globPath.indexOf(rootMarker)
  const path = rootIndex >= 0 ? globPath.slice(rootIndex + rootMarker.length) : globPath
  return trimLeadingSlash(path)
}

export const buildDocumentationDocumentsFromGlob = (
  urls: Record<string, string>,
  options: {
    rootMarker: string
    metadata?: Record<string, unknown>
  },
): DocumentationPageDocument[] =>
  Object.entries(urls)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([globPath, url]) => {
      const path = documentationPathFromGlob(globPath, options.rootMarker)
      return {
        id: path,
        path,
        title: titleFromDocumentationPath(path),
        url,
        ...(options.metadata ? { metadata: options.metadata } : {}),
      }
    })

export const loadDocumentationDocumentContents = async (
  documents: readonly DocumentationPageDocument[],
): Promise<{ documents: LoadedDocumentationDocument[] }> => {
  const loadedDocuments = await Promise.all(
    documents.map(async (document) => {
      if (document.content !== undefined) return { ...document, content: document.content }
      const response = await fetch(document.url, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(`Failed to load documentation ${document.path}: ${response.status}`)
      }
      return {
        ...document,
        content: await response.text(),
      }
    }),
  )
  return { documents: loadedDocuments }
}

export const createDocumentationDocumentLoader =
  (documents: readonly DocumentationPageDocument[]): DocumentationDocumentLoader =>
  () =>
    loadDocumentationDocumentContents(documents)
