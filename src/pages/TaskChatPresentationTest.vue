<template>
  <q-page class="q-pa-md">
    <q-btn label="Enable expert mode" @click="expertMode = true" />
    <q-btn label="Enable dev mode" @click="showAllTasks = true" />
    <TaskChatThread
      :tasks="tasks"
      :tools="tools"
      :expert-mode="expertMode"
      :show-all-tasks="showAllTasks"
    />
    <TaskExecutionProgress :progress="liveProgress" />
    <CopyTaskChatButton data-cy="copy-visible-task-chat" :tasks="visibleTasks" flat dense />
    <TaskChatThread :tasks="reloadedTasks" />
    <TaskChatThread v-if="fixtureReady" :tasks="[storageCall, storageResult]">
      <template #task="{ task, previousTask, nextTask }">
        <TaskWidget :task="task" :previous-task="previousTask" :next-task="nextTask" />
      </template>
    </TaskChatThread>
    <TaskChatThread v-if="fixtureReady" :tasks="[failedStorageCall, failedStorageResult]">
      <template #task="{ task, previousTask, nextTask }">
        <TaskWidget :task="task" :previous-task="previousTask" :next-task="nextTask" />
      </template>
    </TaskChatThread>
    <TaskChatThread v-if="fixtureReady" :tasks="[workspaceCall, workspaceResult]">
      <template #task="{ task, previousTask, nextTask }">
        <TaskWidget :task="task" :previous-task="previousTask" :next-task="nextTask" />
      </template>
    </TaskChatThread>
  </q-page>
</template>

<script setup lang="ts">
import type { TaskNode, ToolBase } from '@taskyon/taskyon'
import CopyTaskChatButton from '@taskyon/ui/components/taskyon/CopyTaskChatButton.vue'
import TaskChatThread from '@taskyon/ui/components/taskyon/TaskChatThread.vue'
import TaskExecutionProgress from '@taskyon/ui/components/taskyon/TaskExecutionProgress.vue'
import { selectTasksForChatCopy } from '@taskyon/ui/components/taskyon/taskChatVisibility'
import type { TaskExecutionProgress as TaskExecutionProgressState } from '@taskyon/ui/modules/taskExecutionProgress'
import TaskWidget from 'components/taskyon/TaskWidget.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { onMounted, ref } from 'vue'

const expertMode = ref(false)
const showAllTasks = ref(false)

const storageCall: TaskNode = {
  id: 'storage-download-call',
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'storage',
      arguments: {
        action: 'download',
        namespace: 'tool-files',
        id: 'presentation-test.pdf',
        url: 'https://example.test/presentation-test.pdf',
      },
    },
  },
}

const storageResult: TaskNode = {
  id: 'storage-download-result',
  role: 'system',
  content: {
    type: 'toolresult',
    data: {
      success: true,
      namespace: 'tool-files',
      id: 'presentation-test.pdf',
      metadata: {
        id: 'presentation-test.pdf',
        size: 26,
        contentType: 'application/pdf',
        modifiedAt: '2026-08-30T00:00:00.000Z',
      },
    },
  },
}

const failedStorageCall: TaskNode = {
  id: 'failed-storage-download-call',
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'storage',
      arguments: {
        action: 'download',
        namespace: 'research',
        id: 'failed-download.pdf',
        url: 'https://example.test/failed-download.pdf',
      },
    },
  },
}

const failedStorageResult: TaskNode = {
  id: 'failed-storage-download-result',
  role: 'system',
  parentID: 'failed-storage-download-call',
  content: { type: 'error', data: 'The storage transport could not fetch the source file.' },
}

const workspaceCall: TaskNode = {
  id: 'workspace-write-call',
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'write',
      arguments: { path: 'docs/note.txt', content: 'Workspace fixture' },
    },
  },
}

const workspaceResult: TaskNode = {
  id: 'workspace-write-result',
  role: 'system',
  content: {
    type: 'toolresult',
    data: { path: 'docs/note.txt', chars: 17, revision: 'sha256:fixture' },
  },
}

const taskyon = useTaskyonStore()
const fixtureReady = ref(false)

onMounted(async () => {
  await taskyon.storageClient.setBlob({
    namespace: 'tool-files',
    id: 'presentation-test.pdf',
    data: new TextEncoder().encode('%PDF-1.7\nTaskyon fixture'),
    contentType: 'application/pdf',
  })
  await taskyon.storageClient.set({
    namespace: 'workspace-files/v1',
    id: 'docs/note.txt',
    value: { version: 1, content: 'Workspace fixture' },
  })
  fixtureReady.value = true
})

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
    id: 'scoped-hidden-definition',
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
    id: 'scoped-hidden-call',
    role: 'function',
    priorID: 'scoped-hidden-definition',
    content: {
      type: 'functioncall',
      data: { name: 'selectTaskyonTools', arguments: { toolSearch: { query: 'files' } } },
    },
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
  {
    id: 'code-declaration',
    role: 'system',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'internalCodeDeclaration',
        description: 'Internal code declaration',
        parameters: { type: 'object' },
        code: 'return undefined',
      },
    },
  },
  {
    id: 'function-binding',
    role: 'system',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'internalFunctionBinding',
        description: 'Internal function binding',
        implementation: {
          type: 'binding',
          target: 'visibleTool',
          fixedArguments: {},
          publicArguments: {},
        },
      },
    },
  },
]

const reloadedTasks: TaskNode[] = [
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

const liveProgress: TaskExecutionProgressState = {
  stage: 'tool progress',
  message: 'Inspecting entities',
  reasoning: 'Checking the available lights.',
  text: 'I found the kitchen light.',
  toolInput: '{"query":"light"}',
  toolName: 'inspectHomeAssistant',
  toolProgress: 'Reading entity state',
  streaming: true,
}
</script>
