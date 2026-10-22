import { canonicalHash, createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageBackendProvider,
  type StorageBlobBackend,
} from '../api/storageProtocol'

export { createInMemoryDatabasePool } from './inMemoryDatabasePool'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const runStorageBackendContract = async (provider: StorageBackendProvider) => {
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const stop = createStorageProtocolServer(servicePort, provider, { mode: 'trusted-local' })
  const storage = createStorageClient(clientPort, {
    namespacePrefix: 'storage-contract',
    distribution: 'local-only',
  })
  const namespace = `contract-${crypto.randomUUID()}`
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  try {
    assert((await storage.get({ namespace, id: 'missing' })).value === null, 'Missing record')
    await storage.set({ namespace, id: 'one', value: { nested: { left: true } } })
    const firstRecord = await storage.get({ namespace, id: 'one' })
    assert(
      firstRecord.contentHash === canonicalHash(firstRecord.value),
      'Derive record content hash',
    )
    const conditionalWrite = await storage.setIfUnchanged({
      namespace,
      id: 'one',
      expectedContentHash: firstRecord.contentHash,
      value: { nested: { left: false } },
    })
    assert(conditionalWrite.written, 'Write record matching its expected content hash')
    const staleWrite = await storage.setIfUnchanged({
      namespace,
      id: 'one',
      expectedContentHash: firstRecord.contentHash,
      value: { stale: true },
    })
    assert(!staleWrite.written, 'Reject stale record content hash')
    await storage.setMany({ namespace, rows: [{ id: 2, data: { batch: true } }] })
    const merged = await storage.upsert({
      namespace,
      id: 'one',
      value: { nested: { right: true } },
      strategy: 'deepmerge',
    })
    assert(
      typeof merged.value === 'object' &&
        merged.value !== null &&
        'nested' in merged.value &&
        typeof merged.value.nested === 'object',
      'Deep merge record',
    )
    const found = await storage.find({ namespace, query: { batch: true } })
    assert('2' in found.values, 'Find numeric record id')
    assert((await storage.listIds({ namespace })).ids.length === 2, 'List record ids')

    const first = encoder.encode('first')
    const firstMetadata = await storage.setBlob({
      namespace,
      id: 'value.txt',
      data: first,
      contentType: 'text/plain',
      provenance: { origin: 'download', sourceUrl: 'https://example.test/value.txt' },
    })
    assert(firstMetadata.contentType === 'text/plain', 'Persist blob media type')
    assert(
      firstMetadata.provenance?.origin === 'download' &&
        firstMetadata.provenance.sourceUrl === 'https://example.test/value.txt',
      'Persist blob provenance',
    )
    assert(
      (await storage.statBlob({ namespace, id: 'value.txt' }))?.contentType === 'text/plain',
      'Reload blob media type',
    )
    assert(
      (await storage.statBlob({ namespace, id: 'value.txt' }))?.provenance?.sourceUrl ===
        'https://example.test/value.txt',
      'Reload blob provenance',
    )
    await storage.appendBlob({
      namespace,
      id: 'value.txt',
      data: encoder.encode('-second'),
      expectedSize: first.byteLength,
    })
    const range = await storage.readBlobRange({
      namespace,
      id: 'value.txt',
      offset: 0,
      length: 100,
    })
    assert(decoder.decode(range.data) === 'first-second', 'Append and range-read blob')
    assert(
      (await storage.statBlob({ namespace, id: 'value.txt' }))?.contentType === 'text/plain',
      'Preserve blob media type after append',
    )
    assert(
      (await storage.statBlob({ namespace, id: 'value.txt' }))?.provenance?.origin === 'download',
      'Preserve blob provenance after append',
    )

    const staged = encoder.encode('staged-value')
    const hasher = createSha256Hasher()
    hasher.update(staged)
    const { writeId } = await storage.beginBlobWrite({
      namespace,
      id: 'staged.bin',
      provenance: { origin: 'tool-save' },
    })
    await storage.writeBlobChunk({ namespace, id: 'staged.bin', writeId, offset: 0, data: staged })
    assert((await storage.statBlob({ namespace, id: 'staged.bin' })) === null, 'Hide staged blob')
    const stagedMetadata = await storage.commitBlobWrite({
      namespace,
      id: 'staged.bin',
      writeId,
      expectedSize: staged.byteLength,
      expectedSha256: hasher.digest(),
    })
    assert(
      stagedMetadata.provenance?.origin === 'tool-save',
      'Persist staged blob provenance',
    )
    assert((await storage.listBlobs({ namespace })).blobs.length === 2, 'List committed blobs')
    const pending = await storage.beginBlobWrite({ namespace, id: 'value.txt' })
    const replacement = encoder.encode('new-value')
    await storage.writeBlobChunk({
      namespace,
      id: 'value.txt',
      writeId: pending.writeId,
      offset: 0,
      data: replacement,
    })
    let rejected = false
    try {
      await storage.writeBlobChunk({
        namespace,
        id: 'different',
        writeId: pending.writeId,
        offset: 0,
        data: replacement,
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'Bind write ID to object ID')
    await storage.abortBlobWrite({ namespace, id: 'different', writeId: pending.writeId })
    assert(
      (await storage.getBlobWriteStatus({ namespace, id: 'value.txt', writeId: pending.writeId }))
        .size === replacement.length,
      'Wrong object must not abort a write',
    )
    rejected = false
    try {
      await storage.commitBlobWrite({
        namespace,
        id: 'value.txt',
        writeId: pending.writeId,
        expectedSize: replacement.length,
        expectedSha256: 'invalid',
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'Reject checksum failure')
    assert(
      decoder.decode((await storage.getBlob({ namespace, id: 'value.txt' }))!.data) ===
        'first-second',
      'Failed commit preserves previous object',
    )
    await storage.writeBlobChunk({
      namespace,
      id: 'value.txt',
      writeId: pending.writeId,
      offset: 1,
      data: encoder.encode('X'),
    })
    await storage.commitBlobWrite({
      namespace,
      id: 'value.txt',
      writeId: pending.writeId,
      expectedSize: replacement.length,
      targetId: 'renamed',
    })
    assert(
      decoder.decode((await storage.getBlob({ namespace, id: 'renamed' }))!.data) === 'nXw-value',
      'Overwrite and publish target ID',
    )
  } finally {
    await storage.clear({ namespace }).catch(() => undefined)
    await storage.clearBlobs({ namespace }).catch(() => undefined)
    stop()
  }
}

export const runStorageStreamingContract = async (provider: StorageBackendProvider) => {
  if (!provider.blobs) throw new Error('Blob backend capability unavailable')
  const namespace = `streaming-contract-${crypto.randomUUID()}`
  const backend = await provider.blobs(namespace)
  if (!backend) throw new Error('Blob backend unavailable')
  const data = new Uint8Array(1024 * 1024).fill(37)
  const { writeId } = await backend.beginWrite('large')
  try {
    for (let index = 0; index < 17; index++)
      await backend.writeChunk('large', writeId, index * data.length, data)
    await backend.writeChunk('large', writeId, data.length - 1, new Uint8Array([7, 8]))
    await backend.commitWrite('large', writeId, 17 * data.length)
    const reopened = await provider.blobs(namespace)
    if (!reopened) throw new Error('Reopened blob backend unavailable')
    const result = await reopened.readRange('large', data.length - 1, 2)
    assert(result.data.join(',') === '7,8', 'Range spanning stored chunks survives reopening')
    assert(
      (await reopened.stat('large'))?.size === 17 * data.length,
      'Large object size survives reopening',
    )
    await reopened.delete('large')
    assert((await reopened.stat('large')) === null, 'Deleted generation stays invisible')
  } finally {
    await backend.abortWrite('large', writeId)
    await backend.clear()
  }
}

export const runStorageLegacyBlobContract = async (backend: StorageBlobBackend) => {
  assert((await backend.readRange('legacy', 1, 2)).data.join(',') === '2,3', 'Legacy range read')
  await backend.append('legacy', new Uint8Array([4]), 3)
  assert((await backend.get('legacy'))?.data.join(',') === '1,2,3,4', 'Legacy append migration')
  await backend.delete('legacy')
  assert((await backend.get('legacy')) === null, 'Deleted legacy data stays invisible')
}
