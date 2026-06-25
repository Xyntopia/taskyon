import {
  convertTaskNodesToOpenAIChat,
  getCommandFromStructuredResponse,
} from '../tools/chatCompletionTool'
import { selectTaskChainIds } from '../core/taskChainSelection'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const task = (node: TaskNode) => node

const createTaskAccess = (tasks: TaskNode[]) => {
  const tasksById = new Map(tasks.map((node) => [node.id, node]))
  const directChildrenByParent = new Map<string, string[]>()
  const nextSiblingByPrior = new Map<string, string[]>()

  for (const node of tasks) {
    if (node.parentID && !node.priorID) {
      const children = directChildrenByParent.get(node.parentID) ?? []
      children.push(node.id)
      directChildrenByParent.set(node.parentID, children)
    }
    if (node.priorID) {
      const siblings = nextSiblingByPrior.get(node.priorID) ?? []
      siblings.push(node.id)
      nextSiblingByPrior.set(node.priorID, siblings)
    }
  }

  const findSiblingLeafTasks = (taskId: string) => {
    const leafTasks: string[] = []
    const pending = [taskId]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      const next = nextSiblingByPrior.get(current) ?? []
      if (next.length === 0) {
        leafTasks.push(current)
      } else {
        pending.push(...next)
      }
    }
    return Promise.resolve(leafTasks)
  }

  return {
    getTask: (taskId: string) => Promise.resolve(tasksById.get(taskId) ?? null),
    getFlattenedChain: () => {
      throw new Error('Flattened task-chain selection is not used by these tests.')
    },
    searchAllDirectChildren: (taskId: string) =>
      Promise.resolve(new Set(directChildrenByParent.get(taskId) ?? [])),
    findSiblingLeafTasks,
  }
}

export const testChatCompletionContextUsesLineageAndTerminalSubtaskResults = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Collect battery spec sheets.' },
    }),
    task({
      id: 'planner-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'webResearchPlanner', arguments: {} } },
    }),
    task({
      id: 'branch-a-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 3,
      content: { type: 'message', data: 'Noisy branch A prompt.' },
    }),
    task({
      id: 'branch-a-internal-tool',
      role: 'function',
      parentID: 'planner-call',
      priorID: 'branch-a-start',
      created_at: 4,
      content: { type: 'functioncall', data: { name: 'downloadFile', arguments: {} } },
    }),
    task({
      id: 'nested-noise-start',
      role: 'user',
      parentID: 'branch-a-internal-tool',
      created_at: 5,
      content: { type: 'message', data: 'Nested branch internals must stay hidden.' },
    }),
    task({
      id: 'nested-noise-result',
      role: 'assistant',
      parentID: 'branch-a-internal-tool',
      priorID: 'nested-noise-start',
      created_at: 6,
      content: { type: 'message', data: 'Nested result should not be pulled into parent chat.' },
    }),
    task({
      id: 'branch-a-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-a-internal-tool',
      created_at: 7,
      content: { type: 'message', data: 'Branch A final summary.' },
    }),
    task({
      id: 'branch-a-return',
      role: 'system',
      parentID: 'planner-call',
      priorID: 'branch-a-result',
      created_at: 8,
      content: { type: 'return', data: 'done' },
    }),
    task({
      id: 'branch-b-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 9,
      content: { type: 'message', data: 'Noisy branch B prompt.' },
    }),
    task({
      id: 'branch-b-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-b-start',
      created_at: 10,
      content: { type: 'structured', data: { result: 'Branch B final summary.' } },
    }),
    task({
      id: 'continue-user',
      role: 'user',
      priorID: 'planner-call',
      created_at: 11,
      content: { type: 'message', data: 'Continue from the research results.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'continue-user',
    1e9,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) ===
      JSON.stringify([
        'root-user',
        'planner-call',
        'branch-a-result',
        'branch-b-result',
        'continue-user',
      ]),
    `Expected lineage plus terminal direct subtask results, got ${JSON.stringify(selectedIds)}`,
  )

  assert(
    !selectedIds.includes('branch-a-start') && !selectedIds.includes('branch-a-internal-tool'),
    'Expected noisy direct subtask internals to stay hidden',
  )
  assert(
    !selectedIds.includes('nested-noise-result'),
    'Expected nested subtask output to stay hidden from the parent chat context',
  )

  return { success: true }
}

export const testChatCompletionContextSizeTrimsAfterLineageSelection = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Root.' },
    }),
    task({
      id: 'tool-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: {} } },
    }),
    task({
      id: 'child-start',
      role: 'user',
      parentID: 'tool-call',
      created_at: 3,
      content: { type: 'message', data: 'Child.' },
    }),
    task({
      id: 'child-result',
      role: 'assistant',
      parentID: 'tool-call',
      priorID: 'child-start',
      created_at: 4,
      content: { type: 'message', data: 'Child result.' },
    }),
    task({
      id: 'next-user',
      role: 'user',
      priorID: 'tool-call',
      created_at: 5,
      content: { type: 'message', data: 'Next.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'next-user',
    2,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) === JSON.stringify(['child-result', 'next-user']),
    `Expected maxFollow to trim after terminal child results are inserted, got ${JSON.stringify(
      selectedIds,
    )}`,
  )

  return { success: true }
}

export const testOrphanedToolResultRendersAsSystemContext = async () => {
  const toolResult = task({
    id: 'terminal-tool-result',
    role: 'system',
    parentID: 'hidden-tool-call',
    created_at: 3,
    content: { type: 'toolresult', data: { summary: 'Terminal branch result.' } },
  })
  const tools: Record<string, ToolBase> = {}

  const messages = await convertTaskNodesToOpenAIChat(
    [toolResult],
    () => Promise.resolve(null),
    () => Promise.resolve(undefined),
    false,
    true,
    tools,
  )

  assert(messages.length === 1, `Expected one rendered message, got ${messages.length}`)
  assert(
    messages[0]?.role === 'system',
    'Expected orphaned tool result to render as system context',
  )

  return { success: true }
}

export const testChooseToolPlainTextResponseDoesNotThrow = () => {
  const response = 'I cannot provide the current time.'
  const commands = getCommandFromStructuredResponse(response)

  assert(Array.isArray(commands), 'Expected command parser to return an array')
  assert(commands.length === 0, 'Expected plain text chooser response to produce no commands')

  return {
    response,
    commands,
  }
}
testChooseToolPlainTextResponseDoesNotThrow.description =
  'Plain text LLM output in ChooseTool/AnalyzeToolResult mode must not crash the structured command parser.'
testChatCompletionContextUsesLineageAndTerminalSubtaskResults.description =
  'chatCompletion context follows parent/prior lineage and exposes terminal direct subtask results without flattening branch internals.'
testChatCompletionContextSizeTrimsAfterLineageSelection.description =
  'chatCompletion context_size maps to maxFollow and limits the final lineage context after terminal subtask results are selected.'
testOrphanedToolResultRendersAsSystemContext.description =
  'Terminal tool results without their hidden function-call parent render as system context instead of orphaned native tool output.'
