import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createProtocolStorageBlobBackend,
  createStorageClient,
  taskyonStorageProtocol,
} from '../../../../taskyon/src/api/storageProtocol'
import { storageRecordFilePath } from '../../../../taskyon/src/api/storageRecordFileBackend'
import { createArtifactStore } from '../../../../taskyon/src/core/artifactStore'
import { connectTaskManagerStorageFromProtocol } from '../../../../taskyon/src/core/taskManager'
import type { TaskNode } from '../../../../taskyon/src/types/taskNode'
import { createCliFileStorageService } from '../../cli/fileStorage'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testCliFileStoragePersistsTaskRecordsAndFindsRelations = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-file-storage-diagnostic-'))
  const sessionId = 'diagnostic-session'

  const firstPort = createProtocolPort(taskyonStorageProtocol)
  const stopFirstService = createCliFileStorageService(firstPort.y, storageRoot)
  const firstStorage = connectTaskManagerStorageFromProtocol(firstPort.x, sessionId)

  const parentTask: TaskNode = {
    id: 'parent-task',
    role: 'user',
    content: { type: 'message', data: 'parent' },
  }
  const childTask: TaskNode = {
    id: 'child-task',
    parentID: 'parent-task',
    role: 'assistant',
    content: { type: 'message', data: 'child' },
  }
  const siblingTask: TaskNode = {
    id: 'sibling-task',
    parentID: 'parent-task',
    priorID: 'child-task',
    role: 'assistant',
    content: { type: 'message', data: 'sibling' },
  }
  await firstStorage.tasks.set('parent-task', parentTask)
  await firstStorage.tasks.setMany([
    { id: 'child-task', data: childTask },
    { id: 'sibling-task', data: siblingTask },
  ])
  await firstStorage.meta.upsert(
    'child-task',
    {
      rawOutput: {
        nested: {
          left: true,
        },
      },
    },
    'replace',
  )
  await firstStorage.meta.upsert(
    'child-task',
    {
      rawOutput: {
        nested: {
          right: true,
        },
      },
    },
    'deepmerge',
  )
  stopFirstService()

  const secondPort = createProtocolPort(taskyonStorageProtocol)
  const stopSecondService = createCliFileStorageService(secondPort.y, storageRoot)
  const secondStorage = connectTaskManagerStorageFromProtocol(secondPort.x, sessionId)

  try {
    const loadedChild = await secondStorage.tasks.get('child-task')
    const loadedBatch = await secondStorage.tasks.getMany([
      'parent-task',
      'sibling-task',
      'missing',
    ])
    const childMeta = await secondStorage.meta.get('child-task')
    const children = await secondStorage.tasks.find({ parentID: 'parent-task' })
    const nextSiblings = await secondStorage.tasks.find({ priorID: 'child-task' })

    assert(
      loadedChild?.id === 'child-task',
      'Expected child task to persist across service restart',
    )
    assert(
      loadedBatch.map(({ id }) => id).join(',') === 'parent-task,sibling-task',
      'Expected batched reads to preserve requested records and omit missing ids',
    )
    assert(children['child-task']?.id === 'child-task', 'Expected parentID find to include child')
    assert(
      children['sibling-task']?.id === 'sibling-task',
      'Expected parentID find to include sibling',
    )
    assert(
      nextSiblings['sibling-task']?.id === 'sibling-task',
      'Expected priorID find to include sibling',
    )
    assert(
      childMeta?.rawOutput &&
        typeof childMeta.rawOutput === 'object' &&
        'nested' in childMeta.rawOutput &&
        childMeta.rawOutput.nested &&
        typeof childMeta.rawOutput.nested === 'object' &&
        'left' in childMeta.rawOutput.nested &&
        childMeta.rawOutput.nested.left === true &&
        'right' in childMeta.rawOutput.nested &&
        childMeta.rawOutput.nested.right === true,
      'Expected deepmerge upsert to roundtrip through the shared record-file backend',
    )
  } finally {
    stopSecondService()
  }
}

testCliFileStoragePersistsTaskRecordsAndFindsRelations.description =
  'Verifies the tycli file-backed storage service persists task records and supports relation queries through the storage protocol.'

export const testCliFileStorageReclaimsAnInterruptedProcessLock = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-stale-lock-diagnostic-'))
  const lockDir = join(storageRoot, 'records', 'stale-session', 'taskyonNodes.lock')
  await mkdir(lockDir, { recursive: true })
  await writeFile(
    join(lockDir, 'owner.json'),
    `${JSON.stringify({ pid: 2_147_483_647, acquiredAt: new Date().toISOString() })}\n`,
    'utf8',
  )

  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const storage = connectTaskManagerStorageFromProtocol(port.x, 'stale-session')
  try {
    await storage.tasks.set('recovered-task', {
      id: 'recovered-task',
      role: 'user',
      content: { type: 'message', data: 'storage recovered' },
    })
    const recovered = await storage.tasks.get('recovered-task')
    assert(recovered?.id === 'recovered-task', 'Expected storage to reclaim the dead owner lock')
  } finally {
    stopService()
  }
}

testCliFileStorageReclaimsAnInterruptedProcessLock.description =
  'Reclaims a namespace lock left behind when an interrupted tycli process no longer exists.'

export const testCliFileStorageSerializesConcurrentNamespaceWrites = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-concurrent-storage-diagnostic-'))
  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const storage = connectTaskManagerStorageFromProtocol(port.x, 'concurrent-session')

  try {
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        storage.tasks.set(`task-${index}`, {
          id: `task-${index}`,
          role: 'assistant',
          content: { type: 'message', data: `result-${index}` },
        }),
      ),
    )
    const tasks = await storage.tasks.list()
    assert(tasks.length === 200, 'Expected every concurrent namespace write to persist')
  } finally {
    stopService()
  }
}

testCliFileStorageSerializesConcurrentNamespaceWrites.description =
  'Serializes bursts of writes within one CLI storage namespace without lock starvation.'

export const testCliFileStorageUsesHashOnlyRecordPaths = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-hashed-record-path-diagnostic-'))
  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const storage = createStorageClient(port.x)
  const id = canonicalHash({
    node: `sha256:${'a'.repeat(64)}`,
    params: `sha256:${'b'.repeat(64)}`,
  })
  const physicalHash = canonicalHash({ type: typeof id, value: id }).slice('sha256:'.length)
  const expectedPath = `records/dag/cache/${physicalHash.slice(0, 2)}/${physicalHash.slice(2)}`

  try {
    await storage.set({ namespace: 'dag/cache', id, value: { artifactHash: 'sha256:result' } })
    const loaded = await storage.get({ namespace: 'dag/cache', id })
    const listed = await storage.list({ namespace: 'dag/cache' })
    assert(
      loaded.value &&
        typeof loaded.value === 'object' &&
        'artifactHash' in loaded.value &&
        loaded.value.artifactHash === 'sha256:result',
      'Expected a hashed DAG cache id to roundtrip through file storage',
    )
    assert(
      listed.rows.some((row) => row.id === id),
      'Expected listing hash-only record paths to preserve the original logical id',
    )
    assert(storageRecordFilePath('dag/cache', id) === expectedPath, 'Expected a Git-style path.')
  } finally {
    stopService()
  }
}

testCliFileStorageUsesHashOnlyRecordPaths.description =
  'Persists computation hashes through Git-style record paths without exposing logical ids.'

export const testCliBlobStorageAppendsAndCommitsStagedWrites = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-blob-storage-diagnostic-'))
  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const storage = createStorageClient(port.x)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  try {
    const first = await storage.appendBlob({
      namespace: 'transcripts',
      id: 'conversation.md',
      data: encoder.encode('first\n'),
      expectedSize: 0,
      contentType: 'text/markdown',
    })
    await storage.appendBlob({
      namespace: 'transcripts',
      id: 'conversation.md',
      data: encoder.encode('second\n'),
      expectedSize: first.size,
    })
    const range = await storage.readBlobRange({
      namespace: 'transcripts',
      id: 'conversation.md',
      offset: 0,
      length: 1024,
    })
    assert(decoder.decode(range.data) === 'first\nsecond\n', 'Expected ordered blob appends')

    const { writeId } = await storage.beginBlobWrite({
      namespace: 'attachments',
      id: 'large.bin',
      contentType: 'application/octet-stream',
    })
    const chunk = encoder.encode('chunked-content')
    await storage.writeBlobChunk({
      namespace: 'attachments',
      id: 'large.bin',
      writeId,
      offset: 0,
      data: chunk,
    })
    assert(
      (await storage.statBlob({ namespace: 'attachments', id: 'large.bin' })) === null,
      'Expected staged blobs to remain hidden before commit',
    )
    await storage.commitBlobWrite({
      namespace: 'attachments',
      id: 'large.bin',
      writeId,
      expectedSize: chunk.byteLength,
    })
    const committed = await storage.getBlob({ namespace: 'attachments', id: 'large.bin' })
    assert(
      committed !== null && decoder.decode(committed.data) === 'chunked-content',
      'Expected committed staged blob to become readable',
    )
  } finally {
    stopService()
  }
}

testCliBlobStorageAppendsAndCommitsStagedWrites.description =
  'Persists append-only transcript blobs and atomically publishes staged attachment writes.'

export const testArtifactStoreDeduplicatesSessionScopedContent = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-task-file-blob-diagnostic-'))
  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const artifacts = createArtifactStore(
    createProtocolStorageBlobBackend(port.x, 'file-session/artifacts'),
  )

  try {
    const first = await artifacts.put(
      new File(['stored attachment'], 'first.txt', { type: 'text/plain' }),
    )
    const renamed = await artifacts.put(
      new File(['stored attachment'], 'renamed.txt', { type: 'text/plain' }),
    )
    const loaded = await artifacts.get(renamed)
    const storedArtifacts = await artifacts.list()
    assert(
      first.hash === renamed.hash &&
        storedArtifacts.length === 1 &&
        storedArtifacts[0]?.id === first.hash,
      'Expected identical content to share one stored blob',
    )
    assert(renamed.name === 'renamed.txt', 'Expected each attachment to retain its own name')
    assert((await loaded?.text()) === 'stored attachment', 'Expected artifact bytes to roundtrip')
  } finally {
    stopService()
  }
}

testArtifactStoreDeduplicatesSessionScopedContent.description =
  'Keeps attachment metadata in content references while deduplicating bytes by hash.'

export const testArtifactStoreStreamsLargeFilesThroughBlobStorage = async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'tycli-task-attachment-diagnostic-'))
  const port = createProtocolPort(taskyonStorageProtocol)
  const stopService = createCliFileStorageService(port.y, storageRoot)
  const artifacts = createArtifactStore(
    createProtocolStorageBlobBackend(port.x, 'attachment-session/artifacts'),
  )
  const bytes = new Uint8Array(1024 * 1024 + 17)
  bytes.fill(42)

  try {
    const attachment = await artifacts.put(new File([bytes], 'large.bin'))
    const loaded = await artifacts.get(attachment)
    if (!loaded) throw new Error('Expected the stored attachment to be readable')
    assert(loaded.size === bytes.byteLength, 'Expected every attachment chunk to be restored')
    assert(
      new Uint8Array(await loaded.arrayBuffer()).every((byte) => byte === 42),
      'Expected restored attachment bytes to match the upload',
    )
  } finally {
    stopService()
  }
}

testArtifactStoreStreamsLargeFilesThroughBlobStorage.description =
  'Stages large artifacts in bounded chunks and verifies them while reading by content hash.'
