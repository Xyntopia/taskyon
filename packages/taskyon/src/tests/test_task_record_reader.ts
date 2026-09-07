import { createTaskRecordReader } from '../api/taskRecordReader'
import { createClientTaskModel } from '../api/clientTaskModel'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'
import { taskNodeToRecord } from '../core/createTasks'
import type { TaskNode } from '../types/taskNode'

export const testTaskRecordReaderUsesExistingStorage = async () => {
  const fixture = createPortableTestStorage()
  const storage = fixture.taskManagerStorageFactory({ sessionId: 'reader-fixture' })
  const task: TaskNode = {
    id: 'answer',
    parentID: 'call',
    role: 'assistant',
    content: { type: 'message', data: 'Stored answer' },
  }
  const record = taskNodeToRecord(task)
  try {
    await storage.tasks.set(task.id, record)
    await storage.contents.set(record.contentRef, { id: record.contentRef, content: task.content })
    const reader = createTaskRecordReader(fixture.storageClient, 'reader-fixture')
    const loaded = await reader.get({ id: task.id })
    if (loaded?.content.data !== 'Stored answer')
      throw new Error('Storage content was not hydrated.')
    const children = await reader.readRecords({ mode: 'children', parentID: 'call' })
    if (children.records[0]?.id !== task.id) throw new Error('Storage child records were not read.')
    const other = createTaskRecordReader(fixture.storageClient, 'other-fixture')
    if (await other.get({ id: task.id })) throw new Error('Reader crossed session scope.')
    if ('set' in reader || 'delete' in reader) throw new Error('Task reader exposed write access.')
    await storage.contents.set(record.contentRef, {
      id: record.contentRef,
      content: { type: 'message', data: 'Corrupt content' },
    })
    let failed = false
    try {
      await reader.get({ id: task.id })
    } catch {
      failed = true
    }
    if (!failed) throw new Error('Reader accepted a content hash mismatch.')
  } finally {
    fixture.destroy()
  }
}
testTaskRecordReaderUsesExistingStorage.description =
  'Reads tasks through the existing storage protocol with scoped namespaces and verified content.'

export const testStorageBackedExportRechecksCachedRecords = async () => {
  const fixture = createPortableTestStorage()
  const storage = fixture.taskManagerStorageFactory({ sessionId: 'export-fixture' })
  const task: TaskNode = {
    id: 'answer',
    role: 'assistant',
    content: { type: 'message', data: 'Cached answer' },
  }
  const record = taskNodeToRecord(task)
  try {
    await storage.tasks.set(task.id, record)
    await storage.contents.set(record.contentRef, { id: record.contentRef, content: task.content })
    const model = createClientTaskModel(
      createTaskRecordReader(fixture.storageClient, 'export-fixture'),
    )
    await model.discover(task.id)
    await storage.tasks.delete(task.id)
    let failed = false
    try {
      await model.exportSelection(task.id)
    } catch {
      failed = true
    }
    if (!failed) throw new Error('Export silently reused a deleted cached record.')
  } finally {
    fixture.destroy()
  }
}
testStorageBackedExportRechecksCachedRecords.description =
  'Revalidates complete exports against storage without adding a deletion wire event.'
