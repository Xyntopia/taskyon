import {
  createStorageRecordFileBackend,
  storageRecordFilePath,
  type StorageRecordFileAdapter,
} from '../api/storageRecordFileBackend'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testFileStorageReadWaitsForActiveWrite = async () => {
  let stored: Parameters<StorageRecordFileAdapter['write']>[1] | null = null
  let releaseWrite: () => void = () => undefined
  let markWriteStarted: () => void = () => undefined
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve
  })
  let writeActive = false
  let lockTail = Promise.resolve()
  const adapter: StorageRecordFileAdapter = {
    read: () => {
      if (writeActive) throw new Error('Read overlapped an active file write.')
      return Promise.resolve(stored)
    },
    write: async (_path, value) => {
      writeActive = true
      markWriteStarted()
      await writeGate
      stored = value
      writeActive = false
    },
    remove: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    clearDirectory: () => Promise.resolve(),
    withNamespaceLock: (_namespace, operation) => {
      const result = lockTail.then(operation)
      lockTail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  }
  const storage = createStorageRecordFileBackend(adapter, 'diagnostics')
  const writing = storage.set('entries', ['first'])
  await writeStarted
  const reading = storage.get('entries')
  releaseWrite()
  await writing

  assert(
    JSON.stringify(await reading) === JSON.stringify(['first']),
    'Expected the read to wait for the active file write and return its complete value.',
  )
}

testFileStorageReadWaitsForActiveWrite.description =
  'Serializes public file-backed record reads with active namespace writes.'

export const testFileStorageReadersShareLockWhileWritesWait = async () => {
  if (typeof navigator === 'undefined' || !navigator.locks)
    return { skipped: true, reason: 'Web Locks are unavailable.' }
  const namespace = `diagnostics-file-lock-${crypto.randomUUID()}`
  const records = new Map<string, Parameters<StorageRecordFileAdapter['write']>[1]>([
    [storageRecordFilePath(namespace, 'a'), { id: 'a', data: 'original' }],
    [storageRecordFilePath(namespace, 'b'), { id: 'b', data: 'second' }],
  ])
  let releaseReads: () => void = () => undefined
  const readGate = new Promise<void>((resolve) => {
    releaseReads = resolve
  })
  let markReadStarted: () => void = () => undefined
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve
  })
  let wrote = false
  const adapter: StorageRecordFileAdapter = {
    read: async (path) => {
      markReadStarted()
      await readGate
      return records.get(path) ?? null
    },
    write: async (path, record) => {
      wrote = true
      records.set(path, record)
    },
    remove: async () => undefined,
    list: async () => [...records.keys()],
    clearDirectory: async () => records.clear(),
    withNamespaceLock: (_directory, operation, mode: 'shared' | 'exclusive' = 'exclusive') =>
      navigator.locks.request(namespace, { mode }, operation),
  }
  const storage = createStorageRecordFileBackend(adapter, namespace)
  const first = storage.get('a')
  const second = storage.get('b')
  let writing: Promise<void> | undefined
  try {
    await readStarted
    const readers = await navigator.locks.query()
    assert(
      readers.held?.filter(({ name, mode }) => name === namespace && mode === 'shared').length ===
        2,
      'Concurrent record reads must hold shared locks rather than serialize behind an exclusive lock.',
    )
    writing = storage.set('a', 'updated')
    const queued = await navigator.locks.query()
    assert(
      !wrote &&
        queued.pending?.some(({ name, mode }) => name === namespace && mode === 'exclusive'),
      'A namespace write must remain blocked until all shared readers finish.',
    )
    releaseReads()
    assert(
      (await first) === 'original' && (await second) === 'second',
      'Readers must see the pre-write snapshot.',
    )
    await writing
    assert(
      (await storage.get('a')) === 'updated',
      'The write must become visible after reader locks release.',
    )
  } finally {
    releaseReads()
    await Promise.allSettled([first, second, writing])
  }
}
testFileStorageReadersShareLockWhileWritesWait.description =
  'Allows concurrent record reads while preserving exclusive namespace writes and complete snapshots.'
