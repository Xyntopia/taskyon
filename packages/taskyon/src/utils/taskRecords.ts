import { createLruCache } from '@taskyon/common/modules/lruCache'
import { TaskContentRecord, TaskNode, type TaskNodeRecord } from '../types/taskNode'
import { taskContentHash } from '../core/createTasks'

/** Content verification and hydration shared by core storage and read-only clients. */
export const createTaskRecordHydrator = (
  getContent: (id: string) => Promise<unknown>,
  cacheSize: number,
) => {
  const cache = cacheSize > 0 ? createLruCache<string, TaskContentRecord>(cacheSize) : undefined
  const hydrate = async (record: TaskNodeRecord): Promise<TaskNode> => {
    let stored = cache?.get(record.contentRef)
    if (!stored) {
      stored = TaskContentRecord.parse(await getContent(record.contentRef))
      if (
        stored.id !== record.contentRef ||
        taskContentHash(stored.content) !== record.contentRef
      ) {
        throw new Error('Stored task content failed verification.')
      }
      cache?.set(record.contentRef, stored)
    }
    return TaskNode.parse({ ...record, contentRef: undefined, content: stored.content })
  }
  return { hydrate, clear: () => cache?.clear() }
}
