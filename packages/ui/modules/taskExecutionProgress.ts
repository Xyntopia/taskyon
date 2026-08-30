import type { ChatCompletionStreamEvent, TyTaskStreamData } from '@taskyon/taskyon'

export type TaskExecutionProgress = {
  stage: TyTaskStreamData['stage'] | undefined
  message: string
  reasoning: string
  text: string
  toolInput: string
  toolName: string
  toolProgress: string
  streaming: boolean
}

export type TaskWorkerStatusState = {
  activeTaskIds: ReadonlySet<string>
  lastActiveTaskId: string | null
  settled: boolean
  taskStages: ReadonlyMap<string, TyTaskStreamData['stage']>
}

export type TaskExecutionProgressState = TaskWorkerStatusState & {
  latestTaskId: string | undefined
  progressByTaskId: ReadonlyMap<string, TaskExecutionProgress>
}

export type SelectedTaskExecutionProgress = TaskExecutionProgress & {
  taskId: string
}

export const createTaskWorkerStatusState = (): TaskWorkerStatusState => ({
  activeTaskIds: new Set(),
  lastActiveTaskId: null,
  settled: true,
  taskStages: new Map(),
})

export const createTaskExecutionProgressState = (): TaskExecutionProgressState => ({
  ...createTaskWorkerStatusState(),
  latestTaskId: undefined,
  progressByTaskId: new Map(),
})

const emptyTaskProgress = (): TaskExecutionProgress => ({
  stage: undefined,
  message: '',
  reasoning: '',
  text: '',
  toolInput: '',
  toolName: '',
  toolProgress: '',
  streaming: false,
})

const workerMessage = (event: TyTaskStreamData) => {
  if (event.progress?.message) return event.progress.message
  if (event.info) return event.info
  switch (event.stage) {
    case 'processing':
      return 'Processing task'
    case 'tool progress':
      return event.toolName ? `Working with ${event.toolName}` : 'Running tool'
    case 'subtasks':
      return 'Processing subtasks'
    case 'processed':
      return 'Finishing child tasks'
    case 'waiting':
      return 'Waiting for the previous step'
    case 'queued':
      return 'Queued'
    default:
      return 'Working'
  }
}

const removeTaskProgress = (state: TaskExecutionProgressState, taskId: string) => {
  const progressByTaskId = new Map(state.progressByTaskId)
  progressByTaskId.delete(taskId)
  return progressByTaskId
}

const appendToolProgress = (current: string, event: TyTaskStreamData) => {
  if (event.stage !== 'tool progress') return current
  const nextLines = (event.progress?.message ?? event.info ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(Boolean)
  return [...current.split('\n').filter(Boolean), ...nextLines].slice(-5).join('\n')
}

export const reduceChatCompletionProgress = (
  state: TaskExecutionProgressState,
  { taskId, chunk }: ChatCompletionStreamEvent,
): TaskExecutionProgressState => {
  const current = state.progressByTaskId.get(taskId) ?? emptyTaskProgress()
  let progress: TaskExecutionProgress
  switch (chunk.type) {
    case 'text-delta':
      progress = { ...current, streaming: true, text: current.text + chunk.text }
      break
    case 'reasoning-delta':
      progress = { ...current, streaming: true, reasoning: current.reasoning + chunk.text }
      break
    case 'tool-input-start':
      progress = { ...current, streaming: true, toolName: chunk.toolName }
      break
    case 'tool-input-delta':
      progress = { ...current, streaming: true, toolInput: current.toolInput + chunk.delta }
      break
    default:
      return state
  }
  const progressByTaskId = new Map(state.progressByTaskId)
  progressByTaskId.set(taskId, progress)
  return { ...state, latestTaskId: taskId, progressByTaskId }
}

const isActiveWorkerStage = (stage: TyTaskStreamData['stage']) =>
  stage === 'processing' || stage === 'in loop' || stage === 'subtasks' || stage === 'tool progress'

const isTaskFinishedStage = (stage: TyTaskStreamData['stage']) =>
  stage === 'processed' || stage === 'finished' || stage === 'error' || stage === 'aborted'

const updatesLastActiveTask = (stage: TyTaskStreamData['stage']) =>
  stage === 'processing' ||
  stage === 'tool progress' ||
  stage === 'processed' ||
  stage === 'finished' ||
  stage === 'error' ||
  stage === 'aborted'

export const reduceTaskWorkerStatus = (
  state: TaskWorkerStatusState,
  event: TyTaskStreamData,
): TaskWorkerStatusState => {
  const taskId = event.taskId ?? event.task?.id
  if (event.stage === 'all processed' || (event.stage === 'aborted' && !taskId)) {
    return { ...state, activeTaskIds: new Set(), settled: true, taskStages: new Map() }
  }
  if (!taskId) return state

  const activeTaskIds = new Set(state.activeTaskIds)
  const taskStages = new Map(state.taskStages)
  if (isTaskFinishedStage(event.stage)) {
    activeTaskIds.delete(taskId)
    taskStages.delete(taskId)
  } else {
    taskStages.set(taskId, event.stage)
    if (isActiveWorkerStage(event.stage)) activeTaskIds.add(taskId)
    else activeTaskIds.delete(taskId)
  }

  return {
    activeTaskIds,
    lastActiveTaskId: updatesLastActiveTask(event.stage) ? taskId : state.lastActiveTaskId,
    settled: event.stage === 'processing' ? false : state.settled,
    taskStages,
  }
}

export const reduceWorkerProgress = (
  state: TaskExecutionProgressState,
  event: TyTaskStreamData,
): TaskExecutionProgressState => {
  const taskId = event.taskId ?? event.task?.id
  if (event.stage === 'all processed' || (event.stage === 'aborted' && !taskId)) {
    return createTaskExecutionProgressState()
  }
  if (!taskId) return state
  const workerStatus = reduceTaskWorkerStatus(state, event)

  const current = state.progressByTaskId.get(taskId)
  const progressByTaskId = ['finished', 'error', 'aborted'].includes(event.stage)
    ? removeTaskProgress(state, taskId)
    : new Map(state.progressByTaskId)
  if (!isTaskFinishedStage(event.stage) || (event.stage === 'processed' && current)) {
    progressByTaskId.set(taskId, {
      ...(current ?? emptyTaskProgress()),
      stage: event.stage,
      message: workerMessage(event),
      toolName: event.toolName ?? current?.toolName ?? '',
      toolProgress: appendToolProgress(current?.toolProgress ?? '', event),
    })
  }

  return {
    ...state,
    ...workerStatus,
    latestTaskId: progressByTaskId.has(taskId)
      ? taskId
      : state.latestTaskId === taskId
        ? [...progressByTaskId.keys()].at(-1)
        : state.latestTaskId,
    progressByTaskId,
  }
}

export const selectTaskExecutionProgress = (
  state: TaskExecutionProgressState,
  taskIds: readonly string[],
  preferredTaskId?: string,
): SelectedTaskExecutionProgress | undefined => {
  const candidates = [preferredTaskId, ...taskIds.toReversed(), state.latestTaskId]
  const taskId =
    candidates.find(
      (candidate): candidate is string =>
        candidate !== undefined && state.progressByTaskId.get(candidate)?.streaming === true,
    ) ??
    candidates.find(
      (candidate): candidate is string =>
        candidate !== undefined && state.progressByTaskId.has(candidate),
    )
  const progress = taskId ? state.progressByTaskId.get(taskId) : undefined
  return taskId && progress ? { taskId, ...progress } : undefined
}
