export type BuildMetadata = {
  commit: string
  publishDate: string
}

export const UNKNOWN_BUILD_METADATA: BuildMetadata = {
  commit: 'unknown',
  publishDate: 'unknown',
}

export const parseBuildMetadata = (value: unknown): BuildMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid build metadata: expected an object')
  }

  const { commit, publishDate } = value as { commit?: unknown; publishDate?: unknown }
  if (
    typeof commit !== 'string' ||
    !commit.trim() ||
    typeof publishDate !== 'string' ||
    !publishDate.trim()
  ) {
    throw new Error('Invalid build metadata: commit and publishDate must be non-empty strings')
  }

  return { commit: commit.trim(), publishDate: publishDate.trim() }
}

export const loadBuildMetadata = async (
  fetchMetadata: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<BuildMetadata> => {
  const response = await fetchMetadata('/build-metadata.json', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Build metadata request failed with HTTP ${response.status}`)
  }
  return parseBuildMetadata(await response.json())
}
