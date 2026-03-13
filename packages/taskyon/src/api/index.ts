// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage } from '../types/apiTypes'
import type { TaskContentType, TaskNode } from '../types/taskNode'
import { partialTaskDraft } from '../types/taskNode'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { type Port } from '@taskyon/shared/modules/frpBus'
import type { ByType } from '../utils/tsHelpers'

export { BaseMessage, TaskyonMessage, TyP2P } from '../types/apiTypes'
export { llmSettings, TyToolchainConfig } from '../types/profiles'
export type { ClientTool } from '../types/toolApi'
export type { FunctionCall } from '../types/tools'
export {
  createDuplexChannel, // utils/frpbus
  createPortApi, // utis/frpbus
  MessageChannelBridge,
} from '@taskyon/shared/modules/frpBus'

export { createTool, makeTaskResult, partialTaskDraft, toolCall }
export type { Port }
export * from '../mcp/bridge'
export * from '../mcp/taskyonBridge'
export * from '../mcp/types'
export type processTasksOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  show?: boolean
  throwOnError?: boolean
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
        if (
          m.type === 'taskCreated' &&
          'task' in m &&
          !!m.task?.id &&
          !!m.task?.parentID &&
          subTasks.has(m.task.parentID)
        ) {
          subTasks.add(m.task.id)
          return true
        }
        return false
      })
      .map((msg) => msg.task)

    return { initialIds, subTaskStream }
  }

// we make the opts mandatory on purpose so that people think about
// some sort of quit condition.
export const processTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) => {
  const send = sendTasks<T>(tyPort)
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const { subTaskStream } = await send(taskList, opts)
    const expectsError =
      quitCondition === 'error' ||
      (Array.isArray(quitCondition) && quitCondition.includes('error'))
    const throwOnError = opts.throwOnError !== false && !expectsError
    const matchesQuitCondition =
      typeof quitCondition === 'string'
        ? (task: TaskNode) => task.content.type === quitCondition
        : typeof quitCondition === 'object' && Array.isArray(quitCondition)
          ? (task: TaskNode) => quitCondition.includes(task.content.type)
          : quitCondition

    return await new Promise<TaskNode>((resolve, reject) => {
      if (opts.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        return
      }

      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined

      const cleanup = (unsub: () => void, onAbort: () => void) => {
        unsub()
        clearTimeout(timeout)
        opts.signal?.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup(unsub, onAbort)
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      }

      const unsub = subTaskStream((task) => {
        if (settled) return

        if (throwOnError && task.content.type === 'error') {
          settled = true
          cleanup(unsub, onAbort)
          reject(new Error(`Task processing failed on task ${task.id}`, { cause: task.content.data }))
          return
        }

        if (matchesQuitCondition(task)) {
          settled = true
          cleanup(unsub, onAbort)
          resolve(task)
        }
      })

      if (opts.timeoutMs) {
        timeout = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup(unsub, onAbort)
          reject(new Error(`Timeout after ${opts.timeoutMs}ms`))
        }, opts.timeoutMs)
      }

      opts.signal?.addEventListener('abort', onAbort)
    })
  }
}
