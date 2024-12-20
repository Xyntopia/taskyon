<template>
  <div class="col" style="background-color: inherit; color: inherit" flat square>
    <div v-if="currentTask" class="q-gutter-xs q-px-xs task-container">
      <q-card
        v-for="task in filteredTasks"
        :key="task.id"
        :flat="$q.dark.isActive"
        :class="[task.role, Object.keys(task.content)[0]]"
      >
        <Task
          :id="task.id"
          :task="task"
          :previous-task="task.priorID ? selectedThread.get(task.priorID) : undefined"
          :next-task="getNextTask(task.id)"
          :is-working="!taskWorkerWaiting && task.id === currentTask.id"
          style="min-width: 300px"
          :class="['q-pa-xs', task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
          :show-id="!!showIds"
        />
      </q-card>
      <!--Render tasks which are in progress-->
      <q-card v-if="!taskWorkerWaiting" class="row">
        <div class="col">
          <ty-markdown
            no-line-numbers
            no-mermaid
            :src="currentTask.debugging.streamContent || ''"
          />
          <ty-markdown
            no-line-numbers
            no-mermaid
            :src="JSON.stringify(currentTask.debugging.toolStreamArgsContent)"
          />
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
import { computed, toRaw } from 'vue'
const $q = useQuasar()

const props = defineProps<{
  selectedThread: Map<string, TaskNode>
  currentTask?: TaskNode | undefined
  taskWorkerWaiting: boolean
  taskWorkerMessage?: string
  showAllTasks?: boolean
  showIds?: boolean
}>()

// Build task list and next task map so that we know for each task what its children are..
// TODO: extend this to multiple children..  we'll have a tree of some sort, I guess at some point...
const nextMap = new Map<string, TaskNode>()
props.selectedThread.forEach((task) => {
  const prev = props.selectedThread.get(task.priorID || '')
  if (prev) nextMap.set(prev.id, task)
})

function getNextTask(id: string) {
  const nextTask = nextMap.get(id)
  return nextTask
}

// TODO: render tasks based on levels :)
const filteredTasks = computed(() => {
  if (props.showAllTasks) return props.selectedThread.values()
  const rawSelectedThread = toRaw(props.selectedThread)
  return rawSelectedThread.values().filter((t) => {
    const hide = t.label ? t.label.includes('hide') : false // TODO: hide tasks based on level as well :)
    const structured =
      t.content && ('structuredResponse' in t.content || 'termination' in t.content)
    return hide || !structured
  })
})
</script>
