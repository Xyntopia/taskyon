import { produce } from 'immer'
import type z from 'zod'
import type { partialTaskDraft } from '../types/node'
import { TaskNode } from '../types/node'
import { sha256UrlSafeHash } from '../utils/crypto'

const TaskWithoutId = TaskNode.omit({ id: true }).strip()
export type TaskWithoutId = z.infer<typeof TaskWithoutId>

function normalizeObj<T>(task: T) {
  const nt = produce(task, (newTask) => {
    // this will usually remove "undefined" values..
    return JSON.parse(JSON.stringify(newTask))
  })
  // TODO: ensure alphabetical order?
  return nt
}

async function taskContentHash(
  task: partialTaskDraft,
): Promise<{ hash: string; normalized: TaskWithoutId }> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'crypto.subtle is not available in this environment, We can currently not generate task IDs!!',
    )
  }

  console.log('generating new hash ID for task')
  // we need to verify that our task is of type TaskNode without ID and we do this using Zod :)
  // we also want to make sure, that we only strip away anything which isn't official
  // part of our tasknode..
  const taskWithoutId = TaskWithoutId.parse(task)
  const normalized = normalizeObj(taskWithoutId)
  // generate this hash ID to check of there are any duplicate tasks or anything like that...
  const hash = await sha256UrlSafeHash(normalized)
  return { hash, normalized }
}

export async function ensureValidTaskId(task: partialTaskDraft): Promise<TaskNode> {
  const { hash, normalized } = await taskContentHash(task)
  if (task.id && hash != task.id) {
    throw new Error(
      `Not able to create new task as id doesn't match content. Expected: ${hash} got: ${task.id}.`,
    )
  }
  const rt = produce(normalized as TaskNode, (t) => {
    t.id = hash
  })
  return rt
}

// the following function can be used to calculate Ids for an entire
// chain.
export const forgeTaskChain = async (tasks: partialTaskDraft[][]) => {
  const flattened: TaskNode[] = []
  for (const tl of tasks) {
    let lastTaskId: string | undefined = undefined
    for (const t of tl) {
      const task = await createTaskNode({ ...t, priorID: lastTaskId }, { createMeta: 'missing' })
      lastTaskId = task.id
      flattened.push(task)
    }
  }
  return flattened
}

function addTaskNodeMeta(
  options: { createMeta?: 'missing' | 'overwrite' | undefined },
  task: partialTaskDraft,
) {
  // TODO: add signatures, task ACL, etc here...
  const next = produce(task, (newTask) => {
    if (options.createMeta == 'overwrite') {
      newTask.created_at = Date.now()
    }
    if (options.createMeta !== undefined) {
      if (!newTask.created_at) newTask.created_at = Date.now()
    }
  })
  return next
}

export const createTaskNode = async (
  task: partialTaskDraft,
  options: {
    createMeta?: 'missing' | 'overwrite' | undefined
  } = { createMeta: 'missing' },
): Promise<TaskNode> => {
  // if task already has an id, do nothing and only ensure, that the id is valid!
  if (!task.id) {
    // TODO: add task signature and other metadata here as well
    const newTask = addTaskNodeMeta(options, task)
    return ensureValidTaskId(newTask)
  }
  return ensureValidTaskId(task)
}
