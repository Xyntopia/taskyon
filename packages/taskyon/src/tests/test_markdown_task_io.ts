import { addMarkdownTaskChain, chat2Md } from '../core/markdownTaskIO'
import { createTaskNode } from '../core/createTasks'
import type { partialTaskDraft } from '../types/taskNode'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const addTaskChainFromMarkdown = async (markdown: string) => {
  let lastTaskId: string | undefined
  return addMarkdownTaskChain(markdown, async (task: partialTaskDraft) => {
    const createdTask = await createTaskNode(
      {
        ...task,
        priorID: lastTaskId,
      },
      { createMeta: 'missing' },
    )
    lastTaskId = createdTask.id
    return createdTask
  })
}

export const testMarkdownPortableTaskRefsRoundtrip = async () => {
  const sourceTask = await createTaskNode(
    {
      role: 'assistant',
      name: 'Source Text',
      content: {
        type: 'message',
        data: 'This text should survive a markdown roundtrip.',
      },
    },
    { createMeta: 'missing' },
  )

  const functionTask = await createTaskNode(
    {
      role: 'function',
      priorID: sourceTask.id,
      content: {
        type: 'functioncall',
        data: {
          name: 'summarizeDocument',
          arguments: {
            $use: {
              document: `_t:${sourceTask.id}`,
            },
            question: 'Summarize this.',
          },
        },
      },
    },
    { createMeta: 'missing' },
  )

  const messageTask = await createTaskNode(
    {
      role: 'assistant',
      priorID: functionTask.id,
      content: {
        type: 'message',
        data: `Embedded value: {{_t:${sourceTask.id}}}`,
      },
    },
    { createMeta: 'missing' },
  )

  const originalChain = [sourceTask, functionTask, messageTask]
  const exportedMarkdown = chat2Md(originalChain, false)
  assert(
    exportedMarkdown.includes('taskRef: Source_Text'),
    `Expected portable markdown to contain a taskRef alias, got:\n${exportedMarkdown}`,
  )
  assert(
    exportedMarkdown.includes('_tref:Source_Text'),
    `Expected portable markdown to rewrite refs to _tref aliases, got:\n${exportedMarkdown}`,
  )

  const importedChain = await addTaskChainFromMarkdown(exportedMarkdown)
  const importedFunctionArgs =
    importedChain[1]?.content.type === 'functioncall'
      ? importedChain[1].content.data.arguments
      : undefined
  const importedMessage =
    importedChain[2]?.content.type === 'message' ? importedChain[2].content.data : undefined

  assert(
    importedFunctionArgs?.$use &&
      typeof importedFunctionArgs.$use === 'object' &&
      (importedFunctionArgs.$use as Record<string, unknown>).document ===
        `_t:${importedChain[0]?.id}`,
    `Expected imported $use ref to point to the imported source task, got ${JSON.stringify(importedFunctionArgs)}`,
  )
  assert(
    importedMessage === `Embedded value: {{_t:${importedChain[0]?.id}}}`,
    `Expected imported message placeholder to point to the imported source task, got ${String(importedMessage)}`,
  )

  const reExportedMarkdown = chat2Md(importedChain, false)
  assert(
    exportedMarkdown === reExportedMarkdown,
    `Expected markdown roundtrip to be stable.\nOriginal:\n${exportedMarkdown}\n\nRe-exported:\n${reExportedMarkdown}`,
  )

  return { success: true }
}

export const testMarkdownImportPreservesValidHashedIds = async () => {
  const hashedTask = await createTaskNode(
    {
      role: 'assistant',
      name: 'Stable task',
      content: {
        type: 'message',
        data: 'Hashed IDs should remain valid when explicitly exported.',
      },
    },
    { createMeta: 'missing' },
  )

  const exportedMarkdown = chat2Md([hashedTask], true)
  const importedChain = await addTaskChainFromMarkdown(exportedMarkdown)
  const importedTask = importedChain[0]

  assert(Boolean(importedTask), 'Expected one imported task')
  assert(
    importedTask?.id === hashedTask.id,
    `Expected import to preserve a legitimate hashed id. Expected ${hashedTask.id}, got ${importedTask?.id}`,
  )

  return { success: true }
}

export const testMarkdownImportRejectsInvalidManualIds = async () => {
  let errorMessage = ''
  try {
    await addTaskChainFromMarkdown(`<!--taskyon
role: assistant
id: demoVariableText
-->

Hello`)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    errorMessage.includes("doesn't match content"),
    `Expected invalid handwritten ids to still be rejected, got ${errorMessage}`,
  )

  return { success: true }
}

testMarkdownPortableTaskRefsRoundtrip.description =
  'Exports portable markdown taskRefs, re-imports them, and reproduces the same markdown output.'
testMarkdownImportPreservesValidHashedIds.description =
  'Preserves legitimate hashed task ids when full markdown metadata is imported again.'
testMarkdownImportRejectsInvalidManualIds.description =
  'Rejects handwritten markdown ids that do not match the task content hash.'
