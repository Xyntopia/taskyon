import type { ResourceFilesLoader } from '@taskyon/common/modules/resourceFiles'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'

const storageSource = (source: string) => {
  const url = new URL(source, location.origin)
  const namespace = url.searchParams.get('namespace')?.trim()
  if (!namespace) throw new Error('Storage resources require a namespace query parameter.')
  return { namespace, id: url.searchParams.get('id')?.trim() || null }
}

export const createStorageResourceFilesLoader = (
  storageClient: TaskyonStorageClient,
): ResourceFilesLoader =>
  async function* (source) {
    const { namespace, id } = storageSource(source)
    const objects = id
      ? [await storageClient.getBlob({ namespace, id })]
      : await storageClient
          .listBlobs({ namespace })
          .then(
            async ({ blobs }) =>
              await Promise.all(
                blobs.map(
                  async (metadata) => await storageClient.getBlob({ namespace, id: metadata.id }),
                ),
              ),
          )
    for (const stored of objects) {
      if (!stored) continue
      yield {
        url: `/resources/storage?namespace=${encodeURIComponent(namespace)}&id=${encodeURIComponent(
          stored.metadata.id,
        )}`,
        path: stored.metadata.id,
        file: new File([stored.data], stored.metadata.id, {
          type: stored.metadata.contentType ?? 'application/octet-stream',
        }),
      }
    }
  }
