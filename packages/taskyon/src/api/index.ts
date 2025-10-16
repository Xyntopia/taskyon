// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage } from '../types/apiTypes'
import type { TaskNode } from '../types/node'
import { partialTaskDraft } from '../types/node'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { type Port } from '../utils/frpBus'
import type { ByType } from '../utils/tsHelpers'

export { llmSettings, TyToolchainConfig } from '../types/profiles'
export { BaseMessage, TyP2P, TaskyonMessage } from '../types/apiTypes'
export type { ClientTool } from '../types/toolApi'
export type { FunctionCall } from '../types/tools'
export {
  createDuplexChannel, // utils/frpbus
  createPortApi, // utis/frpbus
  MessageChannelBridge,
} from '../utils/frpBus'

export { createTool, makeTaskResult, toolCall, partialTaskDraft }
export type { Port }
export type processTasksOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  quitCondition?: (t: TaskNode) => boolean
  show?: boolean
}

export const createChatCompletionTask = (args: chatCompletionParams) =>
  toolCall<chatCompletionParams>({ name: 'chatCompletion', arguments: args })

// we make the opts mandatory on purpose so that poeple thing about
// some sort of quitcondition.
export const processTasks =
  <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) =>
  async (taskList: partialTaskDraft[][], opts: processTasksOpts) => {
    const tasks = await forgeTaskChain(taskList)

    tyPort.send({
      type: 'tasks',
      tasks: tasks,
      execute: true,
      show: opts.show ?? true, // we want to show this task in our GUI as a succesful test
      origin: 'Taskyon Diagnostics',
    })

    const initialIds = tasks.map((t) => t.id)
    const subTasks = new Set<string>(initialIds)

    // filter for all subtasks
    const subTasksCreated = tyPort.receive
      .narrow((m): m is ByType<'taskCreated', TaskyonMessage> & { task: { id: string } } => {
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

    const condition = opts.quitCondition
      ? subTasksCreated.filter(opts.quitCondition)
      : subTasksCreated.filter((t) => t.content.type === 'message')

    const unsub = condition((m) => console.log('received matching message on port:', m))
    const lastMsg = await condition.wait(opts)
    console.log('finished processin all tasks!')
    unsub()
    return lastMsg
  }
