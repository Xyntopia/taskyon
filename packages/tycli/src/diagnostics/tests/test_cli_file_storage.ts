import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { taskyonStorageProtocol } from '../../../../taskyon/src/api/storageProtocol'
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
  const longTaskId = JSON.stringify({
    cacheFormatVersion: 2,
    nodeId: 'resourceFetch',
    nodeCodeHash: `sha256:${'a'.repeat(64)}`,
    paramsHash: `sha256:${'b'.repeat(64)}`,
  })
  const longIdTask: TaskNode = {
    id: longTaskId,
    role: 'user',
    content: { type: 'message', data: 'record with a filesystem-safe hashed filename' },
  }

  await firstStorage.tasks.set('parent-task', parentTask)
  await firstStorage.tasks.set('child-task', childTask)
  await firstStorage.tasks.set('sibling-task', siblingTask)
  await firstStorage.tasks.set(longTaskId, longIdTask)
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
    const loadedLongIdTask = await secondStorage.tasks.get(longTaskId)
    const childMeta = await secondStorage.meta.get('child-task')
    const children = await secondStorage.tasks.find({ parentID: 'parent-task' })
    const nextSiblings = await secondStorage.tasks.find({ priorID: 'child-task' })

    assert(
      loadedChild?.id === 'child-task',
      'Expected child task to persist across service restart',
    )
    assert(
      loadedLongIdTask?.id === longTaskId,
      'Expected a long record ID to persist through a filesystem-safe filename',
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
