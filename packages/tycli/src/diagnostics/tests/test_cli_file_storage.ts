import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createStorageClient,
  taskyonStorageProtocol,
} from '../../../../taskyon/src/api/storageProtocol'
import { storageRecordFilePath } from '../../../../taskyon/src/api/storageRecordFileBackend'
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
  await firstStorage.tasks.set('child-task', childTask)
  await firstStorage.tasks.set('sibling-task', siblingTask)
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
    const childMeta = await secondStorage.meta.get('child-task')
    const children = await secondStorage.tasks.find({ parentID: 'parent-task' })
    const nextSiblings = await secondStorage.tasks.find({ priorID: 'child-task' })

    assert(
      loadedChild?.id === 'child-task',
      'Expected child task to persist across service restart',
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
