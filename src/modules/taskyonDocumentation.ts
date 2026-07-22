import type { ResourceFilesLoader } from '@taskyon/common/modules/resourceFiles'

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
