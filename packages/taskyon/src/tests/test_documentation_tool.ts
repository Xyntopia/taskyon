import {
  createDocumentationIndexTool,
  createTaskyonDocumentationTool,
} from '../tools/documentationTool'
import type { TaskNode } from '../types/taskNode'
import { createSubtasksResult } from '../types/toolApi'
import { getDatabase } from '../utils/pglite.api'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const createTestContext = (taskChain: TaskNode[] = []) => ({
  getExecutionTaskChain: () => Promise.resolve(taskChain),
  createSubtasksResult,
  getSecret: () => Promise.resolve(null),
  setSecret: () => Promise.resolve(),
  stopSignal: new AbortController().signal,
  toolId: 'documentation-test',
})

const getFunctionCallName = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  if (content.type !== 'functioncall') return undefined
  const data = content.data
  return data && typeof data === 'object' && 'name' in data ? data.name : undefined
}

export const testDocumentationIndexStatusStartsEmpty = async () => {
  const db = await getDatabase(`documentation-status-test-${Date.now()}`)
  const tool = createDocumentationIndexTool(db)
  const result = await tool.function?.({ action: 'status', corpusId: 'diagnostic-docs' })

  assert(result && typeof result === 'object', 'Expected documentation status object')
  if (!result || typeof result !== 'object') throw new Error('Expected documentation status object')
  assert(
    'indexed' in result && result.indexed === false,
    'Expected new documentation corpus to be empty',
  )
  assert(
    'chunkCount' in result && result.chunkCount === 0,
    'Expected empty corpus to have no chunks',
  )

  return { success: true }
}

export const testTaskyonDocumentationCreatesConsentReentryChain = async () => {
  const db = await getDatabase(`documentation-consent-test-${Date.now()}`)
  const tool = createTaskyonDocumentationTool(db)
  const result = await tool.function?.({ query: 'How do Taskyon tools work?' }, createTestContext())

  assert(result && typeof result === 'object', 'Expected task result object')
  assert(
    'taskChainList' in result &&
      Array.isArray(result.taskChainList) &&
      result.taskChainList[0]?.length === 2,
    'Expected consent message followed by re-entry function call',
  )
  const chain = 'taskChainList' in result ? result.taskChainList[0] : undefined
  const message = chain?.[0]
  assert(
    message?.content.type === 'message' &&
      message.content.data.includes('taskyon-docs-index-confirm'),
    'Expected consent UI message to include the docs confirm action',
  )
  assert(
    getFunctionCallName(chain?.[1]) === 'taskyonDocumentation',
    'Expected workflow to re-enter taskyonDocumentation after consent UI',
  )

  return { success: true }
}

testDocumentationIndexStatusStartsEmpty.description =
  'Checks that a new documentation index corpus reports empty status without indexing documents.'
testTaskyonDocumentationCreatesConsentReentryChain.description =
  'Checks that Taskyon documentation search asks for in-chat indexing consent before first use.'
