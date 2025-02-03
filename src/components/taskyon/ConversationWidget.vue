<template>
  <div class="col" style="background-color: inherit; color: inherit" flat square>
    <div v-if="currentTask" class="q-gutter-xs q-px-xs task-container">
      <template v-for="(task, idx) in props.selectedThread" :key="task.id">
        <q-card
          v-if="showAllTasks || showTask(task)"
          :flat="$q.dark.isActive"
          :class="[task.role, Object.keys(task.content)[0]]"
        >
          <Task
            :id="task.id"
            :task="task"
            :previous-task="props.selectedThread[idx - 1]"
            :next-task="props.selectedThread[idx + 1]"
            :is-working="!taskWorkerWaiting && task.id === currentTask.id"
            style="min-width: 300px"
            :class="['q-pa-xs', task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
            :show-id="!!showIds"
          />
        </q-card>
      </template>
      <!--Render tasks which are in progress-->
      <q-card v-if="!taskWorkerWaiting" class="row">
        <div class="col">
          <ty-markdown no-line-numbers no-mermaid :src="streamingContent || ''" />
          <q-spinner-dots size="2rem" color="secondary" />
        </div>
      </q-card>
      <div v-else-if="taskWorkerMessage" class="transparent text-negative text-bold q-pa-md">
        {{ taskWorkerMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode } from 'src/modules/taskyon/types'
import Task from 'components/taskyon/TaskWidget.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import { useQuasar } from 'quasar'
import { asyncComputed } from 'src/stores/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
const $q = useQuasar()

const tystate = useTaskyonStore()

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask?: TaskNode | undefined
  taskWorkerWaiting: boolean
  taskWorkerMessage?: string
  showAllTasks?: boolean
  showIds?: boolean
  expertMode?: boolean
}>()

const streamingContent = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  if (props.currentTask?.id)
    return (await tm.debugDb.readReactive(props.currentTask.id)).value?.streamContent
  else return undefined
}, undefined)

// TODO: move this "one layer up" :)
const toolList = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  const toolList = await tm.updateToolDefinitions()
  return toolList
}, undefined)

function showTask(t: TaskNode) {
  console.log('showTask')
  const noHideLabel = !(t.label ? t.label.includes('hide') : false) // TODO: hide tasks based on level as well :)
  let showInChat = true
  if ('functionCall' in t.content) {
    if (toolList.value)
      showInChat = !toolList.value[t.content.functionCall.name]?.renderOptions?.hideChat
    else if (t.content.functionCall.name === 'chatCompletion') showInChat = false
  }
  const showType = !(t.content && ('termination' in t.content || 'toolResult' in t.content))
  const showExpert = 'structuredResponse' in t.content ? props.expertMode : true
  return showExpert && showType && showInChat && noHideLabel
}
</script>
