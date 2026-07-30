<template>
  <q-page class="q-pa-md">
    <TaskChatThread :tasks="tasks" :tools="tools" />
    <CopyTaskChatButton data-cy="copy-visible-task-chat" :tasks="visibleTasks" flat dense />
  </q-page>
</template>

<script setup lang="ts">
import type { TaskNode, ToolBase } from '@taskyon/taskyon'
import CopyTaskChatButton from '@taskyon/ui/components/taskyon/CopyTaskChatButton.vue'
import TaskChatThread from '@taskyon/ui/components/taskyon/TaskChatThread.vue'
import { selectTasksForChatCopy } from '@taskyon/ui/components/taskyon/taskChatVisibility'

const tasks: TaskNode[] = [
  {
    id: 'user-message',
    role: 'user',
    content: { type: 'message', data: 'Visible user message' },
  },
  {
    id: 'hidden-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'hiddenTool', arguments: { secret: 'hidden arguments' } },
    },
  },
  {
    id: 'hidden-result',
    role: 'system',
    content: { type: 'toolresult', data: 'hidden result' },
  },
  {
    id: 'visible-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: { name: 'visibleTool', arguments: { secret: 'collapsed arguments' } },
    },
  },
  {
    id: 'system-message',
    role: 'system',
    content: { type: 'message', data: 'hidden system message' },
  },
  {
    id: 'system-error',
    role: 'system',
    content: { type: 'error', data: 'Visible task error' },
  },
  {
    id: 'assistant-message',
    role: 'assistant',
    content: { type: 'message', data: 'Visible assistant message' },
  },
]

const tools: Record<string, ToolBase> = {
  hiddenTool: {
    name: 'hiddenTool',
    description: 'Hidden test tool',
    parameters: { type: 'object' },
    renderOptions: { hideChat: true },
  },
  visibleTool: {
    name: 'visibleTool',
    description: 'Visible test tool',
    parameters: { type: 'object' },
  },
}

const visibleTasks = selectTasksForChatCopy(tasks, tools, false)
</script>
