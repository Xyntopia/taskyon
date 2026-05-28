import { serializeObject } from '@taskyon/shared/modules/serializeObject.ts'
import type { TaskNode } from '@taskyon/taskyon/types/taskNode.ts'

export type WorkerEvent = {
  stage?: string
  taskId?: string | null
  task?: { id?: string; content?: { type?: string; data?: { name?: string } } } | null
  info?: string
}

export type RendererWrite = (text: string) => void

export type RendererState = {
  debugEnabled: () => boolean
  showRoleTag: () => boolean
  clearThinkingPanel: () => void
  renderThinkingPanel: () => void
  writeLine: RendererWrite
}

const INTERNAL_TASK_TYPES = new Set(['functioncall', 'toolresult', 'structured', 'tooldefinition'])

const toYaml = (value: unknown) =>
  serializeObject(value, {
    format: 'yaml',
    maxDepth: 5,
    maxArrayLength: 12,
    maxObjectKeys: 30,
    maxStringLength: 300,
    includeTruncationMeta: true,
  }).trim()

export const summarizeWorkerEvent = (event: WorkerEvent): string => {
  const taskId = event.task?.id ?? event.taskId ?? 'n/a'
  const toolName =
    event.task?.content?.type === 'functioncall' ? event.task.content?.data?.name : undefined
  const info = event.info ? ` info=${event.info}` : ''
  const tool = toolName ? ` tool=${toolName}` : ''
  return `stage=${event.stage ?? 'unknown'} task=${taskId}${tool}${info}`
}

const renderTaskSummary = (task: TaskNode, showRoleTag: boolean): string => {
  const role = task.role ?? 'unknown'
  if (task.content.type === 'message')
    return showRoleTag ? `[${role}|message] ${task.content.data}` : String(task.content.data)
  if (task.content.type === 'functioncall')
    return showRoleTag
      ? `[${role}|functioncall]\n${toYaml(task.content.data)}`
      : `functioncall\n${toYaml(task.content.data)}`
  if (task.content.type === 'toolresult')
    return showRoleTag ? `[${role}|toolresult]\n${toYaml(task.content.data)}` : `toolresult\n${toYaml(task.content.data)}`
  if (task.content.type === 'error')
    return showRoleTag ? `[${role}|error]\n${toYaml(task.content.data)}` : `error\n${toYaml(task.content.data)}`
  if (task.content.type === 'return')
    return showRoleTag ? `[${role}|return] ${task.content.data}` : String(task.content.data)
  return showRoleTag ? `[${role}|${task.content.type}]` : task.content.type
}

const isVisibleMessageRole = (task: TaskNode) =>
  task.content.type === 'message' && (task.role === 'user' || task.role === 'assistant')

const shouldRenderTask = (task: TaskNode, debugEnabled: boolean) => {
  if (debugEnabled) return true
  if (task.content.type === 'error') return true
  if (isVisibleMessageRole(task)) return true
  if (task.content.type === 'return') return false
  if (INTERNAL_TASK_TYPES.has(task.content.type)) return false
  return false
}

const shouldRenderWorker = (event: WorkerEvent, debugEnabled: boolean) =>
  debugEnabled || event.stage === 'error'

export const renderTaskProgress = (
  state: RendererState,
  task: TaskNode,
  previousSnapshotExists: boolean,
): void => {
  const debugEnabled = state.debugEnabled()
  if (!shouldRenderTask(task, debugEnabled)) return
  state.clearThinkingPanel()
  const prefix = debugEnabled ? (previousSnapshotExists ? '[task updated] ' : '[task] ') : ''
  state.writeLine(`${prefix}${renderTaskSummary(task, state.showRoleTag())}`)
  state.renderThinkingPanel()
}

export const renderWorkerProgress = (state: RendererState, event: WorkerEvent): void => {
  const debugEnabled = state.debugEnabled()
  if (!shouldRenderWorker(event, debugEnabled)) return
  state.clearThinkingPanel()
  state.writeLine(`[worker] ${summarizeWorkerEvent(event)}`)
  if (debugEnabled) state.writeLine(`[worker yaml]\n${toYaml(event)}`)
  state.renderThinkingPanel()
}

export const renderFinalTask = (task: TaskNode): string => {
  const role = task.role ?? 'assistant'
  if (task.content.type === 'message') return `${role}: ${task.content.data}`
  if (task.content.type === 'return') return `${role}: ${task.content.data}`
  if (task.content.type === 'error')
    return `${role} error:\n${typeof task.content.data === 'string' ? task.content.data : JSON.stringify(task.content.data, null, 2)}`
  return `${role}:\n${JSON.stringify(task.content.data, null, 2)}`
}
