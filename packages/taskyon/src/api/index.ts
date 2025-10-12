// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage } from '../types/apiTypes'
import type { partialTaskDraft } from '../types/node'
import { toolCall, createTool, makeTaskResult } from '../types/toolApi'
import { type Port } from '../utils/frpBus'

export type { FunctionCall } from '../types/tools'
export type { ClientTool } from '../types/toolApi'
export {
  createDuplexChannel, // utils/frpbus
  createPortApi, // utis/frpbus
  MessageChannelBridge, // utils/frpbus
} from '../utils/frpBus'

export { createTool, makeTaskResult, toolCall }
export type { Port, TaskyonMessage, partialTaskDraft }
export type processTasksOpts = { timeoutMs?: number; signal?: AbortSignal }

export const createChatCompletionTask = (args: chatCompletionParams) =>
  toolCall<chatCompletionParams>({ name: 'chatCompletion', arguments: args })

export const processTasks =
  <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) =>
  async (taskList: partialTaskDraft[][], opts: processTasksOpts) => {
    const tasks = await forgeTaskChain(taskList)

    tyPort.send({
      type: 'tasks',
      tasks: tasks,
      execute: true,
      show: true, // we want to show this task in our GUI as a succesful test
      origin: 'Taskyon Diagnostics',
    })

    const initialIds = tasks.map((t) => t.id)
    const subTasks = new Set<string>(initialIds)

    type ByType<K extends TaskyonMessage['type']> = Extract<TaskyonMessage, { type: K }>

    // filter for all subtasks
    const subTasksCreated = tyPort.receive
      .narrow((m): m is ByType<'taskCreated'> & { task: { id: string } } => {
        console.log('api received', m)
        /*const valid =
          m.type === 'taskCreated' && 'task' in m && !!m.task?.id && subTasks.has(m.task?.parentID)*/
        //console.log(valid)
        if (
          m.type === 'taskCreated' &&
          'task' in m &&
          !!m.task?.id &&
          !!m.task?.parentID &&
          subTasks.has(m.task?.parentID)
        ) {
          subTasks.add(m.task?.id)
          return true
        }
        return false
      })
      .map((msg) => msg.task)
    const lastMsgStr = subTasksCreated.filter((t) => t.content.type === 'message')
    const unsub = lastMsgStr((m) => console.log('api received last message:', m))
    const lastMsg = await lastMsgStr.wait(opts)
    unsub()
    return lastMsg
  }
