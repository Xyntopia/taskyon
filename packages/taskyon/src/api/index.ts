import { ensureValidIds } from '../core/taskManager'
import type { TaskyonMessage } from '../types/apiTypes'
import type { partialTaskDraft } from '../types/node'
import { type Port } from '../utils/frpBus'

export type processTasksOpts = { timeoutMs?: number; signal?: AbortSignal }

export const processTasks =
  <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) =>
  async (taskList: partialTaskDraft[][], opts: processTasksOpts) => {
    const tasks = await ensureValidIds(taskList)

    tyPort.send({
      type: 'tasks',
      tasks: tasks,
      execute: true,
      show: true, // we want to show this task in our GUI as a succesful test
      origin: 'Taskyon Diagnostics',
    })

    const subTasks = new Set<string>()

    type ByType<K extends TaskyonMessage['type']> = Extract<TaskyonMessage, { type: K }>

    // filter for all subtasks
    const subTasksCreated = tyPort.receive
      .narrow((m): m is ByType<'taskCreated'> & { task: { id: string } } => {
        return m.type === 'taskCreated' && 'task' in m && !!m.task?.id && subTasks.has(m.task?.id)
      })
      .map((msg) => msg.task)
    const unsub1 = subTasksCreated((t) => {
      subTasks.add(t?.id)
    })
    const lastMsg = await subTasksCreated.filter((t) => t.content.type === 'message').wait(opts)

    unsub1()
    return lastMsg
  }
