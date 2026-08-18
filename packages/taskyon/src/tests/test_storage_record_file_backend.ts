import {
  createStorageRecordFileBackend,
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
