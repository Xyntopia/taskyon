import type { TaskNode } from '@taskyon/taskyon'
import { selectTaskChatWindow, selectTasksVisibleInChat } from './taskyon/taskChatVisibility'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testScopedHiddenToolCallsStayOutOfNormalChat = () => {
  const tasks: TaskNode[] = [
    {
      id: 'visibility-user',
      role: 'user',
      content: { type: 'message', data: 'Choose tools for this task.' },
    },
    {
      id: 'scoped-selector-definition',
      role: 'system',
      content: {
        type: 'tooldefinition',
        data: {
          name: 'selectTaskyonTools',
          description: 'Select tools for the next entry-node call.',
          parameters: { type: 'object', additionalProperties: false },
          renderOptions: { hideChat: true },
          code: '() => undefined',
        },
      },
    },
    {
      id: 'scoped-selector-call',
      role: 'function',
      priorID: 'scoped-selector-definition',
      content: {
        type: 'functioncall',
        data: { name: 'selectTaskyonTools', arguments: { toolSearch: { query: 'files' } } },
      },
    },
    {
      id: 'ordinary-tool-definition',
      role: 'system',
      content: {
        type: 'tooldefinition',
        data: {
          name: 'ordinaryTool',
          description: 'An ordinary tool declaration.',
          parameters: { type: 'object' },
          code: '() => undefined',
        },
      },
    },
    {
      id: 'visibility-assistant',
      role: 'assistant',
      content: { type: 'message', data: 'The relevant tool is ready.' },
    },
  ]

  const visible = selectTasksVisibleInChat(tasks, {}, false)
  assert(
    JSON.stringify(visible.map(({ id }) => id)) ===
      JSON.stringify(['visibility-user', 'visibility-assistant']),
    `Expected the scoped hidden selector to stay out of normal chat, got ${JSON.stringify(visible.map(({ id }) => id))}`,
  )

  const visibleInExpertMode = selectTasksVisibleInChat(tasks, {}, true)
  assert(
    JSON.stringify(visibleInExpertMode.map(({ id }) => id)) ===
      JSON.stringify(['visibility-user', 'visibility-assistant']),
    `Expected expert chat to keep declarations hidden outside dev mode, got ${JSON.stringify(visibleInExpertMode.map(({ id }) => id))}`,
  )
}

testScopedHiddenToolCallsStayOutOfNormalChat.description =
  'Hides tool definitions and internal selector calls from normal and expert chat outside dev mode.'

export const testInternalSelectorCallsStayHiddenWithoutScopedDefinition = () => {
  const tasks: TaskNode[] = [
    {
      id: 'reloaded-visibility-user',
      role: 'user',
      content: { type: 'message', data: 'Continue the task.' },
    },
    {
      id: 'reloaded-selector-call',
      role: 'function',
      content: {
        type: 'functioncall',
        data: { name: 'selectTaskyonTools', arguments: { toolSearch: { query: 'files' } } },
      },
    },
    {
      id: 'reloaded-visibility-assistant',
      role: 'assistant',
      content: { type: 'message', data: 'The task is ready.' },
    },
  ]

  const visible = selectTasksVisibleInChat(tasks, {}, false)
  assert(
    !visible.some(
      (task) =>
        task.content.type === 'functioncall' && task.content.data.name === 'selectTaskyonTools',
    ),
    'Expected the internal selector to stay hidden when reload omitted its scoped definition.',
  )
}

testInternalSelectorCallsStayHiddenWithoutScopedDefinition.description =
  'Hides the internal selector when a reloaded chat has no scoped definition metadata.'

export const testTaskChatWindowBoundsRenderedMessages = () => {
  const tasks = Array.from({ length: 40 }, (_, index) => index + 1)

  const bounded = selectTaskChatWindow(tasks, 10)
  assert(
    JSON.stringify(bounded.tasks) === JSON.stringify(tasks.slice(-10)),
    `Expected the newest 10 messages, got ${JSON.stringify(bounded.tasks)}`,
  )
  assert(bounded.hiddenCount === 30, `Expected 30 hidden messages, got ${bounded.hiddenCount}`)

  const unlimited = selectTaskChatWindow(tasks, 0)
  assert(
    unlimited.tasks.length === 40 && unlimited.hiddenCount === 0,
    'Expected a window of 0 to disable windowing',
  )

  const wide = selectTaskChatWindow(tasks, 100)
  assert(
    wide.tasks.length === 40 && wide.hiddenCount === 0,
    'Expected a window wider than the thread to hide nothing',
  )
}

testTaskChatWindowBoundsRenderedMessages.description =
  'Bounds the rendered chat window to the newest messages and reports hidden ones.'
