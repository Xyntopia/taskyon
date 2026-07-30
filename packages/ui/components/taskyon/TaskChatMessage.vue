<template>
  <article
    :class="['task-chat-message', 'task-container', task.role, task.content.type]"
    :data-task-id="task.id"
  >
    <header class="task-chat-message__header">
      <q-icon :name="messageIcon" size="1.1rem" />
      <span class="task-chat-message__role text-caption text-weight-bold">{{ roleLabel }}</span>
      <span v-if="contentLabel" class="task-chat-message__label text-caption">
        {{ contentLabel }}
      </span>
    </header>
    <div v-if="task.content.type !== 'functioncall'" class="task-chat-message__content">
      <TaskContentView :task="task" />
    </div>
  </article>
</template>

<script setup lang="ts">
import {
  mdiAccount,
  mdiAlertCircleOutline,
  mdiCodeJson,
  mdiCogOutline,
  mdiFileDocumentOutline,
  mdiMessageTextOutline,
  mdiTools,
} from '@quasar/extras/mdi-v6'
import type { TaskNode } from '@taskyon/taskyon'
import {
  resolveTaskChatPresentation,
  type TaskChatPresentation,
} from '@taskyon/ui/modules/taskChatPresentation'
import { computed } from 'vue'
import TaskContentView from './TaskContentView.vue'

const props = withDefaults(
  defineProps<{
    task: TaskNode
    presentation?: Partial<TaskChatPresentation>
  }>(),
  {
    presentation: () => ({}),
  },
)

const resolvedPresentation = computed(() => resolveTaskChatPresentation(props.presentation))

const roleLabel = computed(() => {
  switch (props.task.role) {
    case 'user':
      return 'You'
    case 'assistant':
      return resolvedPresentation.value.assistantLabel
    case 'system':
      return 'System'
    case 'function':
      return 'Tool'
    default:
      return 'Task'
  }
})

const contentLabel = computed(() => {
  switch (props.task.content.type) {
    case 'functioncall':
      return props.task.content.data.name
    case 'toolresult':
      return 'Result'
    case 'structured':
      return 'Analysis'
    case 'tooldefinition':
      return props.task.content.data.name
    case 'files':
      return `${props.task.content.data.length} file${props.task.content.data.length === 1 ? '' : 's'}`
    case 'return':
      return 'Completed'
    case 'error':
      return 'Error'
    case 'message':
      return ''
    default:
      return ''
  }
})

const messageIcon = computed(() => {
  switch (props.task.content.type) {
    case 'error':
      return mdiAlertCircleOutline
    case 'functioncall':
    case 'toolresult':
    case 'tooldefinition':
      return mdiTools
    case 'structured':
      return mdiCodeJson
    case 'files':
      return mdiFileDocumentOutline
    case 'return':
      return mdiMessageTextOutline
    case 'message':
      break
  }

  switch (props.task.role) {
    case 'user':
      return mdiAccount
    case 'assistant':
      return resolvedPresentation.value.assistantIcon
    case 'system':
      return mdiCogOutline
    case 'function':
      return mdiTools
    default:
      return mdiMessageTextOutline
  }
})
</script>

<style scoped lang="sass">
.task-chat-message
  width: min(100%, 48rem)
  padding: 0.65rem 0.8rem

  &.user
    align-self: flex-end
    max-width: min(85%, 40rem)

  &.functioncall
    width: fit-content
    max-width: 100%
    padding: 0.3rem 0.55rem

.task-chat-message__header
  display: flex
  align-items: center
  gap: 0.35rem
  min-width: 0
  margin-bottom: 0.3rem

.task-chat-message__label
  min-width: 0
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap

.task-chat-message__content
  min-width: 0

.task-chat-message.functioncall .task-chat-message__header
  margin-bottom: 0
</style>
