import { canonicalHash, createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageBackendProvider,
} from '../api/storageProtocol'

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
    })
    assert(firstMetadata.contentType === 'text/plain', 'Persist blob media type')
    assert(
      (await storage.statBlob({ namespace, id: 'value.txt' }))?.contentType === 'text/plain',
      'Reload blob media type',
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

    const staged = encoder.encode('staged-value')
    const hasher = createSha256Hasher()
    hasher.update(staged)
    const { writeId } = await storage.beginBlobWrite({ namespace, id: 'staged.bin' })
    await storage.writeBlobChunk({ namespace, id: 'staged.bin', writeId, offset: 0, data: staged })
    assert((await storage.statBlob({ namespace, id: 'staged.bin' })) === null, 'Hide staged blob')
    await storage.commitBlobWrite({
      namespace,
      id: 'staged.bin',
      writeId,
      expectedSize: staged.byteLength,
      expectedSha256: hasher.digest(),
    })
    assert((await storage.listBlobs({ namespace })).blobs.length === 2, 'List committed blobs')
  } finally {
    await storage.clear({ namespace }).catch(() => undefined)
    await storage.clearBlobs({ namespace }).catch(() => undefined)
    stop()
  }
}
