<template>
  <SplitTaskyonLayout
    :name="name"
    :persist="persist"
    storage-key-prefix="SplitTaskyonClientView"
    :chat-initially-collapsed="false"
    class="col"
  >
    <slot />
    <template #chat>
      <TaskChatWindow
        v-model:selected-task-id="selectedTaskId"
        :client="client"
        :status="status"
        :error-message="errorMessage"
        :entry-node="entryNode"
        :all-tools="allTools"
        :welcome-message="welcomeMessage"
        :min-mode="minMode"
        :expert-mode="expertMode"
        :show-web-search="showWebSearch"
        :data-cy="chatDataCy"
        :data-runtime-status="status"
      />
    </template>
  </SplitTaskyonLayout>
</template>

<script setup lang="ts">
import type { partialTaskDraft, TaskyonClient, ToolBase } from '@taskyon/taskyon'
import TaskChatWindow from './taskyon/TaskChatWindow.vue'
import SplitTaskyonLayout from './SplitTaskyonLayout.vue'

withDefaults(
  defineProps<{
    name: string
    client: TaskyonClient | undefined
    status?: 'starting' | 'ready' | 'error'
    errorMessage?: string
    entryNode: partialTaskDraft | undefined
    allTools?: Readonly<Record<string, ToolBase>>
    welcomeMessage?: string
    minMode?: boolean
    expertMode?: boolean
    showWebSearch?: boolean
    persist?: boolean
    chatDataCy?: string | undefined
  }>(),
  {
    status: 'starting',
    errorMessage: 'Taskyon could not be started.',
    allTools: () => ({}),
    welcomeMessage: 'How can I help?',
    minMode: false,
    expertMode: false,
    showWebSearch: false,
    persist: false,
    chatDataCy: undefined,
  },
)

const selectedTaskId = defineModel<string | undefined>('selectedTaskId', {
  default: undefined,
})
</script>
