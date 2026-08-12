import type { TaskyonMessageType } from '@taskyon/taskyon'

type CreateChainResponse = Extract<TaskyonMessageType, { type: 'task.createChainResponse' }>

export function trackShownTaskChainRequest(
  shownRequestIds: Set<string>,
  requestId: string,
  show: boolean,
) {
  if (show) shownRequestIds.add(requestId)
}

export function resolveShownTaskChainResponse(
  shownRequestIds: Set<string>,
  response: CreateChainResponse,
) {
  if (!shownRequestIds.delete(response.requestId)) return undefined
  return response.result?.ids.at(-1)
}
