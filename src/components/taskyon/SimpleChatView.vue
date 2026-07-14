<template>
  <template v-for="(task, idx) in selectedThread" :key="task.id">
    <q-expansion-item v-if="reasoning?.get(task.id)" label="reasoning" dense class="text-caption">
      <tyMarkdown :src="reasoning?.get(task.id)!" />
    </q-expansion-item>
    <Task
      v-if="!hiddenTaskIds?.has(task.id) && (showAllTasks || showTask(task))"
      :id="task.id"
      :class="[task.role, task.content.type]"
      :task="task"
      :message-debug="!!state.messageDebug[task.id]"
      :next-task="selectedThread[idx + 1]"
      :is-working="isProcessing(task.id)"
      :show-meta="!!showIds"
      @update:message-debug="(value) => (state.messageDebug[task.id] = value)"
    />
  </template>
</template>

<script setup lang="ts">
import tyMarkdown from '@taskyon/ui/components/tyMarkdown.vue'
import { type TaskNode } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { isTaskVisibleInChat } from 'src/modules/taskyon/taskChatVisibility'
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

function showTask(t: TaskNode) {
  return isTaskVisibleInChat(t, tystate.allTools, expertMode ?? false)
}
</script>
