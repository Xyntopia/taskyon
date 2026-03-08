<template>
  <template v-for="(task, idx) in selectedThread" :key="task.id">
    <q-expansion-item v-if="reasoning?.get(task.id)" label="reasoning" dense class="text-caption">
      <tyMarkdown :src="reasoning?.get(task.id)!" />
    </q-expansion-item>
    <Task
      v-if="showAllTasks || showTask(task)"
      :id="task.id"
      :class="[task.role, task.content.type]"
      :task="task"
      :message-debug="!!state.messageDebug[task.id]"
      :previous-task="selectedThread[idx - 1]"
      :next-task="selectedThread[idx + 1]"
      :is-working="isProcessing(task.id)"
      :show-meta="!!showIds"
      @update:message-debug="(value) => (state.messageDebug[task.id] = value)"
    />
  </template>
</template>

<script setup lang="ts">
import tyMarkdown from '@taskyon/shared/components/tyMarkdown.vue'
import { type TaskNode } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'

const tystate = useTaskyonStore()
const state = useAppStateStore()

const { expertMode, reasoning = undefined } = defineProps<{
  reasoning?: Map<string, string>
  isProcessing: (id: string) => boolean
  showIds: boolean | undefined
  showAllTasks: boolean | undefined
  selectedThread: TaskNode[]
  expertMode?: boolean
}>()

function showTask(t: TaskNode) {
  //console.log('showTask')
  // in our settings we should be able to specify which tasktypes to hide!
  let showInChat = true
  if (t.content.type === 'functioncall') {
    showInChat = !tystate.allTools[t.content.data.name]?.renderOptions?.hideChat
  }
  const showType = !['return'].includes(t.content.type)
  const showExpert = t.content.type === 'structured' ? expertMode : true
  return showExpert && showType && showInChat
}
</script>
