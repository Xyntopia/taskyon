type ProtocolLogMessage = {
  type?: unknown
  requestId?: unknown
  result?: unknown
}

const taskIdentity = (value: unknown) => {
  if (typeof value !== 'object' || value === null || !('id' in value)) return undefined
  return typeof value.id === 'string' ? value.id : undefined
}

export const summarizeProtocolMessageForLog = (message: unknown): unknown => {
  if (typeof message !== 'object' || message === null) return message
  const candidate: ProtocolLogMessage = message
  if (candidate.type !== 'task.getChainResponse' || !Array.isArray(candidate.result)) {
    return message
  }
  return {
    type: candidate.type,
    requestId: candidate.requestId,
    result: {
      taskCount: candidate.result.length,
      firstTaskId: taskIdentity(candidate.result[0]),
      lastTaskId: taskIdentity(candidate.result.at(-1)),
    },
  }
}
