// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage } from '../types/apiTypes'
import type { TaskContentType, TaskNode } from '../types/node'
import { partialTaskDraft } from '../types/node'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { type Port } from '../utils/frpBus'
import type { ByType } from '../utils/tsHelpers'

export { BaseMessage, TaskyonMessage, TyP2P } from '../types/apiTypes'
export { llmSettings, TyToolchainConfig } from '../types/profiles'
export type { ClientTool } from '../types/toolApi'
export type { FunctionCall } from '../types/tools'
export {
  createDuplexChannel, // utils/frpbus
  createPortApi, // utis/frpbus
  MessageChannelBridge,
} from '../utils/frpBus'

export { createTool, makeTaskResult, partialTaskDraft, toolCall }
export type { Port }
export * from '../mcp/bridge'
export * from '../mcp/taskyonBridge'
export * from '../mcp/types'
export type processTasksOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  show?: boolean
}

export const createChatCompletionTask = (args: chatCompletionParams) =>
  toolCall<chatCompletionParams>({ name: 'chatCompletion', arguments: args })

export const sendTasks =
  <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) =>
  async (taskList: partialTaskDraft[][], opts: processTasksOpts) => {
    const tasks = await forgeTaskChain(taskList)

    tyPort.send({
      type: 'tasks',
      tasks: tasks,
      execute: true,
      show: opts.show ?? true, // we want to show this task in our GUI as a succesful test
      origin: window.origin,
    })

    const initialIds = tasks.map((t) => t.id)
    const subTasks = new Set<string>(initialIds)

    // filter for all subtasks
    const subTaskStream = tyPort.receive
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

    return { initialIds, subTaskStream }
  }

// we make the opts mandatory on purpose so that poeple thing about
// some sort of quitcondition.
export const processTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) => {
  const send = sendTasks<T>(tyPort)
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const { subTaskStream } = await send(taskList, opts)
    const condition =
      typeof quitCondition === 'string'
        ? subTaskStream.filter((t) => t.content.type === quitCondition)
        : typeof quitCondition === 'object' && Array.isArray(quitCondition)
          ? subTaskStream.filter((t) => quitCondition.includes(t.content.type))
          : subTaskStream.filter(quitCondition)

    const unsub = condition((m) => console.log('received matching message on port:', m))
    const lastMsg = await condition.wait(opts)
    console.log('finished processin all tasks!')
    unsub()
    return lastMsg
  }
}
