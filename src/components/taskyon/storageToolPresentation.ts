import type { TaskNode } from '@taskyon/taskyon'

type StorageAction = 'save' | 'download' | 'read' | 'list' | 'delete' | 'exists'
type WorkspaceAction = 'read' | 'write' | 'edit'

export type StorageToolPresentation = {
  action: StorageAction | WorkspaceAction
  location?: { namespace: string; id: string; kind: 'blob' | 'record' }
  sourceUrl?: string
  status: 'running' | 'succeeded' | 'failed'
  size?: number
  contentType?: string
  storedObjectAvailable: boolean
  downloadEnabled: boolean
  viewEnabled: boolean
}

const isStorageAction = (value: string): value is StorageAction => {
  switch (value) {
    case 'save':
    case 'download':
    case 'read':
    case 'list':
    case 'delete':
    case 'exists':
      return true
    default:
      return false
  }
}

const isWorkspaceAction = (value: string): value is WorkspaceAction => {
  switch (value) {
    case 'read':
    case 'write':
    case 'edit':
      return true
    default:
      return false
  }
}

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringValue = (value: unknown) => (typeof value === 'string' ? value : undefined)

export const isStorageFunctionCall = (task: TaskNode | undefined) =>
  task?.content.type === 'functioncall' && task.content.data.name === 'storage'

export const isFileFunctionCall = (task: TaskNode | undefined) =>
  isStorageFunctionCall(task) ||
  (task?.content.type === 'functioncall' && isWorkspaceAction(task.content.data.name))

const resolveWorkspaceFilePresentation = (
  task: TaskNode,
  resultTask?: TaskNode,
): StorageToolPresentation | undefined => {
  if (task.content.type !== 'functioncall' || !isWorkspaceAction(task.content.data.name)) {
    return undefined
  }
  const args = objectValue(task.content.data.arguments)
  const path = stringValue(args?.path)
  if (!path) return undefined
  const result =
    resultTask?.content.type === 'toolresult' ? objectValue(resultTask.content.data) : undefined
  const status = resultTask?.content.type === 'error' ? 'failed' : result ? 'succeeded' : 'running'
  return {
    action: task.content.data.name,
    location: { namespace: 'workspace-files/v1', id: path, kind: 'record' },
    status,
    ...(typeof result?.chars === 'number' ? { size: result.chars } : {}),
    contentType: 'text/plain',
    storedObjectAvailable: status === 'succeeded',
    downloadEnabled: status === 'succeeded',
    viewEnabled: status === 'succeeded',
  }
}

export const resolveStorageToolPresentation = (
  task: TaskNode,
  resultTask?: TaskNode,
): StorageToolPresentation | undefined => {
  if (!isStorageFunctionCall(task) || task.content.type !== 'functioncall') {
    return resolveWorkspaceFilePresentation(task, resultTask)
  }
  const args = objectValue(task.content.data.arguments)
  const action = stringValue(args?.action)
  if (!action || !isStorageAction(action)) return undefined

  const result =
    resultTask?.content.type === 'toolresult' ? objectValue(resultTask.content.data) : undefined
  const metadata = objectValue(result?.metadata)
  const namespace = stringValue(result?.namespace) ?? stringValue(args?.namespace) ?? 'tool-files'
  const id = stringValue(result?.id) ?? stringValue(args?.id)
  const sourceUrl = stringValue(args?.url)
  const contentType = stringValue(metadata?.contentType)
  const status = resultTask?.content.type === 'error' ? 'failed' : result ? 'succeeded' : 'running'
  const exists = action !== 'exists' || result?.exists === true
  const storedObjectAvailable =
    status === 'succeeded' && action !== 'delete' && exists && id !== undefined
  const sourceAvailable = sourceUrl !== undefined

  return {
    action,
    ...(id ? { location: { namespace, id, kind: 'blob' as const } } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    status,
    ...(typeof metadata?.size === 'number' ? { size: metadata.size } : {}),
    ...(contentType ? { contentType } : {}),
    storedObjectAvailable,
    downloadEnabled: storedObjectAvailable || sourceAvailable,
    viewEnabled: storedObjectAvailable || sourceAvailable,
  }
}
