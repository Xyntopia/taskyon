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
          {{ currentStream }}
          <ty-markdown no-line-numbers no-mermaid :src="currentStream || ''" />
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
import { computed, onBeforeUnmount } from 'vue'
import { ref } from 'vue'
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

const streamingContentTracker = ref<Map<string, string>>(new Map<string, string>())

const streamCallback: Parameters<typeof tystate.streamCallBacks.addGlobal>[0] = ({
  taskId,
  chunk,
}) => {
  console.log('received stream for', taskId)
  if (chunk?.choices[0]?.delta?.tool_calls) {
    chunk?.choices[0]?.delta?.tool_calls.forEach((t) => {
      // TODO: add streaming for function calls
      console.log(t)
    })
  }
  if (chunk?.choices[0]?.delta?.content) {
    streamingContentTracker.value.set(
      taskId,
      (streamingContentTracker.value.get(taskId) ?? '') + chunk.choices[0].delta.content,
    )
  }
}

tystate.streamCallBacks.addGlobal(streamCallback)
onBeforeUnmount(() => {
  tystate.streamCallBacks.removeGlobal(streamCallback)
})

const currentStream = computed(() => {
  if (props.currentTask) return streamingContentTracker.value.get(props.currentTask.id)
  else return undefined
})

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
  if (t.content.type === 'functioncall') {
    if (toolList.value) showInChat = !toolList.value[t.content.data.name]?.renderOptions?.hideChat
    else if (t.content.data.name === 'chatCompletion') showInChat = false
  }
  const showType = !(t.content.type in ['termination', 'toolresult'])
  const showExpert = t.content.type === 'structured' ? props.expertMode : true
  return showExpert && showType && showInChat && noHideLabel
}
</script>
