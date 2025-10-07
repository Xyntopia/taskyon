import { ensureValidIds } from '../core/taskManager'
import type { TaskyonMessage } from '../types/apiTypes'
import type { partialTaskDraft, TaskNode } from '../types/node'
import { waitForMsg, type Port } from '../utils/frpBus'

export const processTasks = async <T extends { type: string }>(
  tyPort: Port<T | TaskyonMessage>,
  taskList: partialTaskDraft[][],
) => {
  const tasks = await ensureValidIds(taskList)

  tyPort.send({
    type: 'tasks',
    tasks: tasks,
    execute: true,
    show: true, // we want to show this task in our GUI as a succesful test
    origin: 'Taskyon Diagnostics',
  })

  const msg = await waitForMsg(
    tyPort.receive,
    (m): m is { type: 'taskCreated'; task: TaskNode } =>
      m.type === 'taskCreated' && 'task' in m && m.task?.parentID === tasks.at(-1)?.id,
    { timeoutMs: 100000 },
  )

  return msg
}
