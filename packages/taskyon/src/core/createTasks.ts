import type z from 'zod'
import type { partialTaskDraft } from '../types/taskNode'
import { TaskNode } from '../types/taskNode'
import type { TaskContent, TaskNodeRecord } from '../types/taskNode'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'

const TaskWithoutId = TaskNode.omit({ id: true }).strip()
export type TaskWithoutId = z.infer<typeof TaskWithoutId>

function normalizeObj<T extends Record<string, unknown>>(task: T): T {
  // deep clone plain JSON-compatible values
  const clone: T = JSON.parse(JSON.stringify(task))

  // enforce alphabetical key order
  const sorted = Object.keys(clone)
    .sort()
    .reduce((acc, key) => {
      acc[key as keyof T] = clone[key as keyof T]
      return acc
    }, {} as T)

  return sorted
}

export const taskContentHash = (content: TaskContent) =>
  canonicalHash({ kind: 'taskyon.task-content.v1', content })

async function taskNodeHash(
  task: partialTaskDraft,
): Promise<{ hash: string; normalized: TaskWithoutId }> {
  // we need to verify that our task is of type TaskNode without ID and we do this using Zod :)
  // we also want to make sure, that we only strip away anything which isn't official
  // part of our tasknode..
  const taskWithoutId = await TaskWithoutId.parseAsync(task)
  const normalized = normalizeObj(taskWithoutId)
  // generate this hash ID to check of there are any duplicate tasks or anything like that...
  const { content, ...activation } = normalized
  const hash = canonicalHash({
    kind: 'taskyon.task-node.v1',
    ...activation,
    contentRef: taskContentHash(content),
  }).slice('sha256:'.length)
  return { hash, normalized }
}

export async function ensureValidTaskId(task: partialTaskDraft): Promise<TaskNode> {
  const { hash, normalized } = await taskNodeHash(task)
  if (task.id && hash !== task.id) {
    throw new Error(
      `Not able to create new task as id doesn't match content. Expected: ${hash} got: ${task.id}.`,
    )
  }
  return { ...normalized, id: hash } as TaskNode
}

export const taskNodeToRecord = (task: TaskNode): TaskNodeRecord => {
  const { content, ...activation } = task
  return { ...activation, contentRef: taskContentHash(content) }
}

// the following function can be used to calculate Ids for an entire
// chain.
export const forgeTaskChain = async (
  tasks: partialTaskDraft[][],
  priorTaskIds: Array<string | undefined> = [],
) => {
  const flattened: TaskNode[] = []
  for (const [index, tl] of tasks.entries()) {
    let lastTaskId = priorTaskIds[index]
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
): partialTaskDraft {
  const next = { ...task }
  if (options.createMeta === 'overwrite') {
    next.created_at = Date.now()
  }
  if (options.createMeta !== undefined && !next.created_at) {
    next.created_at = Date.now()
  }
  return next
}

export const createTaskNode = async (
  task: partialTaskDraft,
  options: { createMeta?: 'missing' | 'overwrite' | undefined } = { createMeta: 'missing' },
): Promise<TaskNode> => {
  // if task already has an id, do nothing and only ensure, that the id is valid!
  if (!task.id) {
    // TODO: add task signature and other metadata here as well
    const newTask = addTaskNodeMeta(options, task)
    return ensureValidTaskId(newTask)
  }
  return ensureValidTaskId(task)
}
