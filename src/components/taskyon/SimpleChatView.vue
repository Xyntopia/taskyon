<template>
  <TaskChatThread
    :tasks="selectedThread"
    :tools="tystate.allTools"
    :reasoning="reasoning"
    :hidden-task-ids="hiddenTaskIds"
    :show-all-tasks="showAllTasks"
    :expert-mode="expertMode"
  >
    <template #task="{ task, nextTask }">
      <Task
        :id="task.id"
        :class="[task.role, task.content.type]"
        :task="task"
        :message-debug="!!state.messageDebug[task.id]"
        :next-task="nextTask"
        :is-working="isProcessing(task.id)"
        :show-meta="!!showIds"
        @update:message-debug="(value) => (state.messageDebug[task.id] = value)"
      />
    </template>
  </TaskChatThread>
</template>

<script setup lang="ts">
import TaskChatThread from '@taskyon/ui/components/taskyon/TaskChatThread.vue'
import { type TaskNode } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'

const tystate = useTaskyonStore()
const state = useAppStateStore()

const {
  expertMode,
  reasoning = undefined,
  hiddenTaskIds = new Set<string>(),
} = defineProps<{
  reasoning?: Map<string, string>
  isProcessing: (id: string) => boolean
  showIds: boolean | undefined
  showAllTasks: boolean | undefined
  selectedThread: TaskNode[]
  expertMode?: boolean
  hiddenTaskIds?: ReadonlySet<string>
}>()
</script>
