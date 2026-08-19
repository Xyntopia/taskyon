export type PromptPrefixStatus = {
  activeTasks: number
  model: string
  provider: string
  taskState: 'idle' | 'processing' | 'finished'
  cost?: string
  costIncomplete?: boolean
  cachePercent?: number | null
}

const formatPromptTaskState = (status: PromptPrefixStatus) => {
  if (status.activeTasks <= 0) return status.taskState
  return `${status.taskState}:${status.activeTasks}`
}

const formatPromptCost = (status: PromptPrefixStatus) => {
  if (status.cost) return `cost ${status.cost}${status.costIncomplete ? '*' : ''}`
  if (status.costIncomplete) return 'cost unavailable*'
  return undefined
}

export const formatPromptPrefixLine = (status: PromptPrefixStatus) => {
  const fields = [
    status.provider,
    status.model,
    formatPromptTaskState(status),
    formatPromptCost(status),
    status.cachePercent === undefined || status.cachePercent === null
      ? undefined
      : `cache ${Math.round(status.cachePercent)}%`,
  ].filter((field): field is string => field !== undefined)
  return `[${fields.join(' | ')}]`
}
