import {
  countAutonomousErrorAttempt,
  createAutonomousErrorSignature,
  detectRepeatedToolCall,
  MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS,
  MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE,
} from '../core/taskWorkerErrors'
import type { TaskNode } from '../types/taskNode'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const createEntryNodeTask = (id: string): TaskNode => ({
  id,
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'entryNode',
      arguments: {},
    },
  },
})

export const testAutonomousErrorSignaturesIgnoreVolatileRemoteRequestIds = () => {
  const first = new Error(
    'Remote function entryNode failed for request entryNode-gHHI2NSOexmUsOsPc6S6y400AIJk3XTQJLmFkA-LOb0-1782941204851-29: Remote function entryNode failed for request entryNode-1782941204855-29: getExecutionTaskChain is not implemented for external tool clients yet.\nname=Error\nname=Error',
  )
  const second = new Error(
    'Remote function entryNode failed for request entryNode-abcDefGhIjKlMnOpQrStUvWxYz-1782941209999-42: Remote function entryNode failed for request entryNode-1782941210001-43: getExecutionTaskChain is not implemented for external tool clients yet.\nname=Error',
  )

  const firstSignature = createAutonomousErrorSignature(first)
  const secondSignature = createAutonomousErrorSignature(second)

  assert(firstSignature === secondSignature, 'Remote wrapper ids should not change the signature')
  assert(
    firstSignature === 'getexecutiontaskchain is not implemented for external tool clients yet.',
    `Unexpected signature: ${firstSignature}`,
  )
}

export const testAutonomousErrorAttemptCounterCapsEquivalentToolFailures = () => {
  const attempts = new Map<string, number>()
  const task = createEntryNodeTask('entry-node-call')
  const error = new Error(
    'Remote function entryNode failed for request entryNode-a-1782941204851-1: getExecutionTaskChain is not implemented for external tool clients yet.',
  )

  const counts = Array.from({ length: MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE }, () =>
    countAutonomousErrorAttempt(attempts, task, error),
  )

  assert(
    counts.at(-1) === MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE,
    `Expected attempt cap count to be reached, got ${String(counts.at(-1))}`,
  )
  assert(attempts.size === 1, `Expected one normalized error counter, got ${attempts.size}`)
}

const createFunctionCallTask = (
  id: string,
  name: string,
  args: Record<string, unknown>,
): TaskNode => ({
  id,
  role: 'function',
  content: { type: 'functioncall', data: { name, arguments: args } },
})

export const testRepeatedToolCallDetectionIgnoresConfiguredToolNames = () => {
  const repeatedCall = { action: 'view', path: 'AGENTS.md', startLine: 1, endLine: 40 }
  const taskChain = [
    createFunctionCallTask('exploration-1', 'exploration', repeatedCall),
    createFunctionCallTask('entry-1', 'entryNode', {}),
    createFunctionCallTask('completion-1', 'chatCompletion', {}),
    createFunctionCallTask('exploration-2', 'exploration', repeatedCall),
    createFunctionCallTask('entry-2', 'entryNode', {}),
    createFunctionCallTask('completion-2', 'chatCompletion', {}),
    createFunctionCallTask('exploration-3', 'exploration', {
      endLine: 40,
      path: 'AGENTS.md',
      action: 'view',
      startLine: 1,
    }),
  ]

  const detected = detectRepeatedToolCall(taskChain)
  assert(detected !== undefined, 'Expected the third identical tool call to be detected')
  assert(
    detected?.count === MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS,
    `Expected ${MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS} repeated calls, got ${String(detected?.count)}`,
  )
  assert(detected?.toolName === 'exploration', 'Expected the repeated exploration call')
}

export const testRepeatedToolCallDetectionResetsAfterMeaningfulProgress = () => {
  const repeatedCall = { action: 'view', path: 'AGENTS.md', startLine: 1, endLine: 40 }
  const taskChain = [
    createFunctionCallTask('exploration-1', 'exploration', repeatedCall),
    createFunctionCallTask('entry-1', 'entryNode', {}),
    createFunctionCallTask('exploration-2', 'exploration', repeatedCall),
    createFunctionCallTask('search', 'exploration', { action: 'search', query: 'WebGPU' }),
    createFunctionCallTask('exploration-3', 'exploration', repeatedCall),
  ]

  assert(
    detectRepeatedToolCall(taskChain) === undefined,
    'A different domain tool call should reset repeated-call detection',
  )
}

export const testRepeatedToolCallDetectionDoesNotBlockLaterIgnoredTool = () => {
  const repeatedCall = { action: 'view', path: 'AGENTS.md', startLine: 1, endLine: 40 }
  const taskChain = [
    createFunctionCallTask('exploration-1', 'exploration', repeatedCall),
    createFunctionCallTask('exploration-2', 'exploration', repeatedCall),
    createFunctionCallTask('exploration-3', 'exploration', repeatedCall),
    createFunctionCallTask('new-entry', 'entryNode', {}),
  ]

  assert(
    detectRepeatedToolCall(taskChain) === undefined,
    'A later user turn must not be blocked by repeated calls from the prior turn',
  )
}

export const testRepeatedToolCallDetectionUsesConfiguredIgnoredNames = () => {
  const taskChain = [
    createFunctionCallTask('completion-1', 'configuredCompletion', {}),
    createFunctionCallTask('completion-2', 'configuredCompletion', {}),
    createFunctionCallTask('completion-3', 'configuredCompletion', {}),
  ]

  assert(
    detectRepeatedToolCall(taskChain, new Set(['configuredCompletion'])) === undefined,
    'Configured chat completion tools must remain ignored by repeated-call detection',
  )
}

export const testRepeatedToolCallDetectionResetsAtANewUserTurn = () => {
  const repeatedCall = { action: 'view', path: 'AGENTS.md', startLine: 1, endLine: 40 }
  const taskChain = [
    createFunctionCallTask('exploration-1', 'exploration', repeatedCall),
    createFunctionCallTask('exploration-2', 'exploration', repeatedCall),
    {
      id: 'new-user-turn',
      role: 'user' as const,
      content: { type: 'message' as const, data: 'Try that read again in a new turn.' },
    },
    createFunctionCallTask('exploration-3', 'exploration', repeatedCall),
  ]

  assert(
    detectRepeatedToolCall(taskChain) === undefined,
    'A new user turn should reset repeated-call detection',
  )
}
