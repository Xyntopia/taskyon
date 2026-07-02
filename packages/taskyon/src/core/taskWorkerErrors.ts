import type { TaskNode } from '../types/taskNode'

export const MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE = 5

const toAutonomousErrorText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`
  }
  if (value instanceof Error) return value.message
  return ''
}

const stripRemoteFunctionFailureWrappers = (text: string) => {
  let remaining = text
  let previous = ''

  while (remaining !== previous) {
    previous = remaining
    remaining = remaining.replace(/remote function [\w-]+ failed for request [^\s:]+:\s*/gi, '')
  }

  return remaining
}

const normalizeAutonomousErrorText = (value: unknown) =>
  stripRemoteFunctionFailureWrappers(toAutonomousErrorText(value))
    .replace(/\bname\s*=\s*error\b/gi, ' ')
    .replace(/\brequest\s+[^\s:]+/gi, 'request <id>')
    .replace(/\b\d{10,}\b/g, '<number>')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const extractAutonomousErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return toAutonomousErrorText((error as { message?: unknown }).message)
  }
  return ''
}

export const createAutonomousErrorSignature = (error: unknown) =>
  normalizeAutonomousErrorText(extractAutonomousErrorMessage(error))

const autonomousErrorCounterKey = (task: TaskNode, signature: string) => {
  const toolName =
    task.content.type === 'functioncall' ? task.content.data.name : `t/${task.content.type}`
  return `${toolName}:${signature}`
}

export function countAutonomousErrorAttempt(
  attemptsBySignature: Map<string, number>,
  task: TaskNode,
  error: unknown,
) {
  const signature = createAutonomousErrorSignature(error)
  const key = autonomousErrorCounterKey(task, signature.length > 0 ? signature : '<empty>')
  const count = (attemptsBySignature.get(key) ?? 0) + 1
  attemptsBySignature.set(key, count)
  return count
}
