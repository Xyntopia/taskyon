import { canonicalHash } from '../caching'
import { createNode } from '../dagCore'
import { createInvocationDefinition, type InvocationDefinition } from '../designGraphModel'
import { createSourceManifestRepository, createSourceSnapshot } from '../sourceManifest'
import { createStorageDagBackend, type DagStorageRecords } from '../storageDagBackend'

const readTextFile = async (path: string, read: (path: string) => Promise<string>) => {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('Text file sources require a safe project-relative path.')
  const content = await read(path)
  if (new TextEncoder().encode(content).byteLength > 2_000_000)
    throw new Error('Text file sources are limited to 2 MB; use a blob source for larger files.')
  return content
}

export const createTextFileSourceNode = (read: (path: string) => Promise<string>) =>
  createNode({
    name: 'textFileSource',
    version: 1,
    effect: 'source',
    contentHash: canonicalHash({
      operation: 'textFileSource.v1',
      implementation: readTextFile.toString(),
    }),
    localParams: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    } as const,
    outputSchema: { type: 'string' } as const,
    run: async ({ path }) => await readTextFile(path, read),
  })

/** An upload/import supplies bytes; subsequent replay uses the accepted manifest, not the path. */
export const ingestTextFile = async (
  path: string,
  content: string,
  storage: DagStorageRecords,
  nowUtcMs: number,
) => {
  const node = createTextFileSourceNode(() => Promise.resolve(content))
  const repository = createSourceManifestRepository(storage)
  await node.call({ path }).run(
    { nowUtcMs, log: () => undefined },
    {
      storageBackend: createStorageDagBackend(storage),
      execution: { mode: 'local' },
      sourceExecution: {
        repository,
        defaultPolicy: { mode: 'always' },
        refreshedAcquisitionKeys: new Set(),
      },
    },
  )
  const acquisitionKey = canonicalHash({
    kind: 'taskyon.sourceAcquisition.v1',
    nodeHash: node.contentHash,
    paramsHash: canonicalHash({ path }),
  })
  const manifest = await repository.getCurrent(acquisitionKey)
  if (!manifest) throw new Error('Text file acquisition did not produce a source manifest.')
  const snapshot = createSourceSnapshot({ [acquisitionKey]: manifest })
  await repository.putSnapshot(snapshot)
  return createInvocationDefinition({
    rootNodeId: node.contentHash!,
    sourceSnapshotId: snapshot.id,
    variables: { path: { kind: 'constant', value: path } },
    inputs: {},
    objectives: [],
    constraints: [],
    capture: [],
    policy: { accuracy: 'exact' },
    reducerOverrides: {},
  })
}

export const readPinnedTextFile = async (
  invocation: InvocationDefinition,
  storage: DagStorageRecords,
) => {
  const node = createTextFileSourceNode(() => {
    throw new Error('Pinned file bytes are unavailable; explicitly re-import the file.')
  })
  const path = invocation.variables.path
  if (
    invocation.rootNodeId !== node.contentHash ||
    !invocation.sourceSnapshotId ||
    path?.kind !== 'constant' ||
    typeof path.value !== 'string'
  )
    throw new Error('Expected a pinned text file invocation.')
  const repository = createSourceManifestRepository(storage)
  const snapshot = await repository.getSnapshot(invocation.sourceSnapshotId)
  if (!snapshot) throw new Error('Pinned file source snapshot is unavailable.')
  const result = await node.call({ path: path.value }).run(
    { nowUtcMs: 0, log: () => undefined },
    {
      storageBackend: createStorageDagBackend(storage),
      execution: { mode: 'local' },
      sourceExecution: {
        repository,
        snapshot,
        defaultPolicy: { mode: 'manual' },
        refreshedAcquisitionKeys: new Set(),
      },
    },
  )
  return result.value
}
