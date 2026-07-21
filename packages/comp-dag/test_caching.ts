import { canonicalHash } from './caching'
import { createStorageDagBackend } from './storageDagBackend'
import { createResourceFetchNode } from './resourceFetchNode'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testCanonicalHashUsesStableSha256 = () => {
  const left = canonicalHash({ beta: 2, alpha: 1 })
  const right = canonicalHash({ alpha: 1, beta: 2 })

  assert(left === right, 'Expected object key ordering not to affect canonical hashes.')
  assert(
    left === 'sha256:955c071f4fbee40a01b9bc6e8fb3627e81bda84811ae9c29fcc5812ba3a45162',
    `Expected the SHA-256 digest of the canonical JSON value, got ${left}.`,
  )

  return { success: true, hash: left }
}

export const testResourceFetchNodeInlinesOnlyEligibleInternalFiles = async () => {
  const node = createResourceFetchNode(async function* (source) {
    yield await Promise.resolve({
      url: source,
      file: new File(['small documentation'], 'document.md', {
        type: 'text/markdown',
      }),
    })
  })

  const internal = await node
    .call({
      source: '/docs/document.md',
      revision: canonicalHash('small documentation'),
      cache: 'internal',
      maxInlineBytes: 1_000_000,
    })
    .run()
  const external = await node
    .call({
      source: 'https://example.com/document.md',
      revision: canonicalHash('https://example.com/document.md'),
      cache: 'external',
      maxInlineBytes: 1_000_000,
    })
    .run()

  assert('contentBase64' in internal.value, 'Expected the small internal file inline.')
  assert(!('contentBase64' in external.value), 'Expected the external file as a reference.')
  assert(external.value.url === 'https://example.com/document.md', 'Expected the source reference.')

  return { success: true }
}

export const testStorageDagBackendPersistsArtifactsAndCacheEntries = async () => {
  const namespaces = new Map<string, Map<string, unknown>>()
  const records = (namespace: string) => {
    const existing = namespaces.get(namespace)
    if (existing) return existing
    const created = new Map<string, unknown>()
    namespaces.set(namespace, created)
    return created
  }
  const backend = createStorageDagBackend({
    get: (namespace, id) => Promise.resolve(records(namespace).get(id) ?? null),
    set: (namespace, id, value) => {
      records(namespace).set(id, value)
      return Promise.resolve()
    },
  })

  const artifact = await backend.writeArtifact({ content: 'cached documentation' })
  await backend.setCacheEntry('download-key', { artifact })

  assert(
    JSON.stringify(await backend.readArtifact(artifact)) ===
      JSON.stringify({ content: 'cached documentation' }),
    'Expected the artifact to round-trip through storage records.',
  )
  assert(
    (await backend.getCacheEntry('download-key'))?.artifact === artifact,
    'Expected an independent cache-key record.',
  )
  assert(records('dag/artifacts').has(artifact), 'Expected a content-addressed artifact record.')
  assert(records('dag/cache').has('download-key'), 'Expected a cache catalog record.')
  return { success: true }
}

testCanonicalHashUsesStableSha256.description =
  'Uses a real SHA-256 digest over canonical JSON values.'
testResourceFetchNodeInlinesOnlyEligibleInternalFiles.description =
  'Materializes small internal files while keeping external resources reference-only.'
testStorageDagBackendPersistsArtifactsAndCacheEntries.description =
  'Persists DAG artifacts and cache entries through content-agnostic storage records.'
