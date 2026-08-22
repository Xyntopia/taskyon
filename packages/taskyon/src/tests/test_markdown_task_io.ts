import {
  addMarkdownTaskChain,
  chat2Md,
  chatToYaml,
  createMarkdownChatRenderer,
  createMarkdownTaskDocument,
  parseYamlTaskDocument,
  renderMarkdownDocumentMetadata,
} from '../core/markdownTaskIO'
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

export const testMarkdownImportPreservesTaskTopology = async () => {
  const importedChain = await createMarkdownTaskDocument(`<!--taskyon
role: user
-->

Original message

---

<!--taskyon
role: function
parentID: stale-parent-id
content:
  type: functioncall
  data:
    name: entryNode
    arguments: {}
-->
`)

  assert(
    importedChain.tasks.length === 2,
    `Expected two imported tasks, got ${importedChain.tasks.length}`,
  )
  assert(
    importedChain.tasks[0]?.parentID === undefined &&
      importedChain.tasks[1]?.parentID === 'stale-parent-id',
    `Expected imported tasks to preserve parent IDs, got ${JSON.stringify(importedChain.tasks)}`,
  )
  assert(
    importedChain.tasks[1]?.priorID === importedChain.tasks[0]?.id,
    'Expected imported tasks to retain their prior chain.',
  )

  return { success: true }
}

export const testMarkdownArchivePreservesCompleteTopology = async () => {
  const parent = await createTaskNode(
    { role: 'user', content: { type: 'message', data: 'Original message' } },
    { createMeta: 'missing' },
  )
  const firstChild = await createTaskNode(
    {
      role: 'function',
      parentID: parent.id,
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    },
    { createMeta: 'missing' },
  )
  const secondChild = await createTaskNode(
    {
      role: 'function',
      parentID: parent.id,
      priorID: firstChild.id,
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    },
    { createMeta: 'missing' },
  )
  const markdown = chat2Md([parent, firstChild, secondChild], true, { leafID: secondChild.id })
  const imported = await createMarkdownTaskDocument(markdown)

  assert(imported.leafID === secondChild.id, 'Expected the Markdown leaf ID to survive import.')
  assert(imported.tasks[0]?.id === parent.id, 'Expected the parent ID to survive import.')
  assert(
    imported.tasks[1]?.parentID === parent.id && imported.tasks[1]?.priorID === undefined,
    'Expected the first child topology to survive import.',
  )
  assert(
    imported.tasks[2]?.parentID === parent.id && imported.tasks[2]?.priorID === firstChild.id,
    'Expected the second child topology to survive import.',
  )
  assert(
    imported.tasks[1]?.content.type === 'functioncall' &&
      imported.tasks[2]?.content.type === 'functioncall' &&
      JSON.stringify(imported.tasks[1].content) === JSON.stringify(imported.tasks[2].content),
    'Expected repeated EntryNode content aliases to hydrate identically.',
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

export const testMarkdownCompactsRepeatedFunctionCalls = async () => {
  const call = {
    type: 'functioncall' as const,
    data: {
      name: 'toolSearcher',
      arguments: { query: 'deck geometry', limit: 3 },
    },
  }
  const firstTask = await createTaskNode(
    { role: 'function', content: call },
    { createMeta: 'missing' },
  )
  const repeatedTask = await createTaskNode(
    { role: 'function', priorID: firstTask.id, content: call },
    { createMeta: 'missing' },
  )

  const compactMarkdown = chat2Md([firstTask, repeatedTask], false, {
    compactRepeatedToolCalls: true,
  })
  assert(
    compactMarkdown.includes('contentAlias: toolSearcher_call'),
    `Expected repeated function-call content to use a contentAlias, got:\n${compactMarkdown}`,
  )
  const expandedMarkdown = chat2Md([firstTask, repeatedTask], false, {
    compactRepeatedToolCalls: false,
  })
  assert(
    !expandedMarkdown.includes('contentAlias:'),
    'Expected content aliases to remain disableable for display-only Markdown',
  )

  const renderer = createMarkdownChatRenderer({ compactRepeatedToolCalls: true })
  renderer.render([firstTask])
  const compactSuffix = renderer.render([repeatedTask])
  assert(
    compactSuffix.includes('contentAlias: toolSearcher_call'),
    'Expected the stateful renderer used by CLI append persistence to reuse prior content aliases',
  )

  const importedChain = await addTaskChainFromMarkdown(compactMarkdown)
  assert(
    JSON.stringify(importedChain[0]?.content) === JSON.stringify(importedChain[1]?.content),
    'Expected a contentAlias to restore the repeated function-call content on import',
  )
  return { success: true }
}

export const testTaskDocumentYamlRoundtripPreservesTopology = async () => {
  const root = await createTaskNode(
    { role: 'user', content: { type: 'message', data: 'Archive root' } },
    { createMeta: 'missing' },
  )
  const child = await createTaskNode(
    {
      role: 'assistant',
      parentID: root.id,
      content: { type: 'message', data: 'Archive child' },
    },
    { createMeta: 'missing' },
  )
  const yaml = chatToYaml([root, child], { leafID: child.id })
  const imported = parseYamlTaskDocument(yaml)

  assert(imported.leafID === child.id, 'Expected YAML to preserve the active leaf ID.')
  assert(imported.tasks[0]?.id === root.id, 'Expected YAML to preserve the root ID.')
  assert(
    imported.tasks[1]?.parentID === root.id,
    'Expected YAML to preserve the child parent link.',
  )
  assert(
    JSON.stringify(imported.tasks[1]?.content) === JSON.stringify(child.content),
    'Expected YAML to restore the original task content.',
  )
  return { success: true }
}

export const testMarkdownStreamingMetadataUsesLatestLeaf = async () => {
  const first = await createTaskNode(
    { role: 'user', content: { type: 'message', data: 'First streamed task' } },
    { createMeta: 'missing' },
  )
  const second = await createTaskNode(
    {
      role: 'assistant',
      parentID: first.id,
      content: { type: 'message', data: 'Second streamed task' },
    },
    { createMeta: 'missing' },
  )
  const renderer = createMarkdownChatRenderer({ compactRepeatedToolCalls: true })
  const markdown = [
    renderer.render([first], true),
    renderMarkdownDocumentMetadata(first.id),
    '\n---\n',
    renderer.render([second], true),
    renderMarkdownDocumentMetadata(second.id),
  ].join('\n')
  const imported = await createMarkdownTaskDocument(markdown)

  assert(imported.leafID === second.id, 'Expected the latest streamed leaf ID to win.')
  assert(
    imported.tasks.length === 2,
    'Expected streamed Markdown metadata to leave both tasks intact.',
  )
  assert(
    imported.tasks[1]?.parentID === first.id,
    'Expected streamed Markdown to preserve the child parent link.',
  )
  return { success: true }
}

testMarkdownPortableTaskRefsRoundtrip.description =
  'Exports portable markdown taskRefs, re-imports them, and reproduces the same markdown output.'
testMarkdownImportPreservesTaskTopology.description =
  'Preserves parent IDs instead of flattening persisted Markdown topology.'
testMarkdownArchivePreservesCompleteTopology.description =
  'Preserves exact task IDs, parent/prior links, active leaf, and aliased content in Markdown archives.'
testMarkdownImportPreservesValidHashedIds.description =
  'Preserves legitimate hashed task ids when full markdown metadata is imported again.'
testMarkdownImportRejectsInvalidManualIds.description =
  'Rejects handwritten markdown ids that do not match the task content hash.'
testMarkdownCompactsRepeatedFunctionCalls.description =
  'Uses readable content aliases for repeated function-call content while retaining an opt-out display mode.'
testTaskDocumentYamlRoundtripPreservesTopology.description =
  'Round-trips a task archive through YAML without changing topology or content.'
testMarkdownStreamingMetadataUsesLatestLeaf.description =
  'Imports append-only Markdown document state and uses the latest active leaf metadata.'
