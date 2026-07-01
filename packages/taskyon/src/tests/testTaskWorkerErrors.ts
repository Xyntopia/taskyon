import {
  countAutonomousErrorAttempt,
  createAutonomousErrorSignature,
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
