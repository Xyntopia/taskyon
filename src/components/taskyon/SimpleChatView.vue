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
      :previous-task="selectedThread[idx - 1]"
      :next-task="selectedThread[idx + 1]"
      :is-working="isProcessing(task.id)"
      :show-meta="!!showIds"
    />
  </template>
</template>

<script setup lang="ts">
import { type TaskNode } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'

const tystate = useTaskyonStore()

const { expertMode } = defineProps<{
  reasoning?: Map<string, string>
  isProcessing: (id: string) => boolean
  showIds: boolean | undefined
  showAllTasks: boolean | undefined
  selectedThread: TaskNode[]
  expertMode?: boolean | undefined
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
