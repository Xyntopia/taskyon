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
const $q = useQuasar()

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask?: TaskNode | undefined
  taskWorkerWaiting: boolean
  taskWorkerMessage?: string
  showAllTasks?: boolean
  showIds?: boolean
}>()

function showTask(t: TaskNode) {
  const hide = t.label ? t.label.includes('hide') : false // TODO: hide tasks based on level as well :)
  const structured =
    t.content &&
    ('structuredResponse' in t.content || 'termination' in t.content || 'toolResult' in t.content)
  return hide || !structured
}
</script>
