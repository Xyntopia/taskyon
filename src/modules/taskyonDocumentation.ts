import {
  createDocumentationDocument,
  type LoadedDocumentationDocument,
} from '@taskyon/common/modules/documentation'
import {
  documentationSourceUrl,
  filterDocumentationManifestSources,
  loadDocumentationManifestFiles,
  type ResourceFilesLoader,
} from '@taskyon/common/modules/resourceFiles'
import { taskyonDocumentationManifest } from '@taskyon/taskyon/documentationManifest'

const authoredDocumentationManifest = filterDocumentationManifestSources(
  taskyonDocumentationManifest,
  (source) => documentationSourceUrl(source).startsWith('/docs/'),
)

export const loadTaskyonAuthoredResourceFiles: ResourceFilesLoader = async function* (source) {
  const response = await fetch(source, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Failed to load ${source}: ${response.status}`)
  const blob = await response.blob()
  yield {
    url: source,
    path: source.slice('/docs/'.length),
    file: new File([blob], source.split('/').at(-1) ?? 'document', {
      type: blob.type || response.headers.get('content-type') || 'application/octet-stream',
    }),
  }
}

export const loadTaskyonDocumentationDocuments = async (): Promise<
  LoadedDocumentationDocument[]
> => {
  const loaded = await loadDocumentationManifestFiles(
    authoredDocumentationManifest,
    loadTaskyonAuthoredResourceFiles,
  )
  const failure = loaded.errors[0]
  if (failure) throw new Error(`Failed to load ${failure.source}: ${failure.message}`)

  return await Promise.all(
    loaded.files.map(async ({ url, path, file, aliases, chapters }) =>
      createDocumentationDocument({
        path: path ?? file.name,
        url,
        aliases,
        chapters,
        content: await file.text(),
      }),
    ),
  )
}
