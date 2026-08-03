<template>
  <TaskChatWindow
    v-model:selected-task-id="selectedTaskId"
    v-model:recent-task-ids="recentTaskIds"
    :client="client"
    :status="status"
    :error-message="errorMessage"
    :entry-node="entryNode"
    :all-tools="allTools"
    :welcome-message="welcomeMessage"
    :min-mode="minMode"
    :expert-mode="expertMode"
    :show-web-search="showWebSearch"
    :show-assistant-identity="showAssistantIdentity"
    :presentation="presentation"
    :data-cy="chatDataCy"
    :data-runtime-status="status"
  />
</template>

<script setup lang="ts">
import type { partialTaskDraft, TaskyonClient, ToolBase } from '@taskyon/taskyon'
import type { TaskChatPresentation } from '../modules/taskChatPresentation'
import TaskChatWindow from './taskyon/TaskChatWindow.vue'

const {
  client,
  status = 'starting',
  errorMessage = 'Taskyon could not be started.',
  entryNode,
  allTools = {},
  welcomeMessage = 'How can I help?',
  minMode = false,
  expertMode = false,
  showWebSearch = false,
  showAssistantIdentity = true,
  chatDataCy = undefined,
  presentation = {},
} = defineProps<{
  client: TaskyonClient | undefined
  status?: 'starting' | 'ready' | 'error' | undefined
  errorMessage?: string | undefined
  entryNode: partialTaskDraft | undefined
  allTools?: Readonly<Record<string, ToolBase>> | undefined
  welcomeMessage?: string | undefined
  minMode?: boolean | undefined
  expertMode?: boolean | undefined
  showWebSearch?: boolean | undefined
  showAssistantIdentity?: boolean | undefined
  chatDataCy?: string | undefined
  presentation?: Partial<TaskChatPresentation> | undefined
}>()

const selectedTaskId = defineModel<string | undefined>('selectedTaskId', {
  default: undefined,
})
const recentTaskIds = defineModel<string[]>('recentTaskIds', { default: () => [] })
</script>
