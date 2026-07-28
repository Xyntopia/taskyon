import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { TaskNode } from '../types/taskNode'

export const MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE = 5
export const MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS = 3

const DEFAULT_REPEATED_CALL_DETECTION_IGNORED_TOOL_NAMES = new Set(['chatCompletion', 'entryNode'])

const toolCallSignature = (task: TaskNode) =>
  task.content.type === 'functioncall'
    ? canonicalJson({
        name: task.content.data.name,
        arguments: task.content.data.arguments,
      })
    : undefined

export const detectRepeatedToolCall = (
  taskChain: TaskNode[],
  repeatedCallDetectionIgnoredToolNames: ReadonlySet<string> = DEFAULT_REPEATED_CALL_DETECTION_IGNORED_TOOL_NAMES,
) => {
  const currentTask = taskChain.at(-1)
  if (
    !currentTask ||
    currentTask.content.type !== 'functioncall' ||
    repeatedCallDetectionIgnoredToolNames.has(currentTask.content.data.name)
  ) {
    return undefined
  }
  const latestSignature = toolCallSignature(currentTask)
  let count = 0
  for (let index = taskChain.length - 1; index >= 0; index -= 1) {
    const task = taskChain[index]!
    if (task.role === 'user' && task.content.type === 'message') break
    if (task.content.type !== 'functioncall') continue
    if (repeatedCallDetectionIgnoredToolNames.has(task.content.data.name)) continue
    if (toolCallSignature(task) !== latestSignature) break
    count += 1
  }

  return count >= MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS
    ? { count, toolName: currentTask.content.data.name }
    : undefined
}

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
