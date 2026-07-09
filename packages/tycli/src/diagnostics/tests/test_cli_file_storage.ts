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

  await firstStorage.tasks.set('parent-task', parentTask)
  await firstStorage.tasks.set('child-task', childTask)
  await firstStorage.tasks.set('sibling-task', siblingTask)
  stopFirstService()

  const secondPort = createProtocolPort(taskyonStorageProtocol)
  const stopSecondService = createCliFileStorageService(secondPort.y, storageRoot)
  const secondStorage = connectTaskManagerStorageFromProtocol(secondPort.x, sessionId)

  try {
    const loadedChild = await secondStorage.tasks.get('child-task')
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
  } finally {
    stopSecondService()
  }
}

testCliFileStoragePersistsTaskRecordsAndFindsRelations.description =
  'Verifies the tycli file-backed storage service persists task records and supports relation queries through the storage protocol.'
