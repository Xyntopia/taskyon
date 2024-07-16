<template>
  <div
    class="col"
    style="background-color: inherit; color: inherit"
    flat
    square
  >
    <div v-if="currentTask" class="q-gutter-xs q-px-xs task-container">
      <q-card
        v-for="task in selectedThread"
        :key="task.id"
        :flat="$q.dark.isActive"
        :class="task.role"
      >
        <Task
          v-if="!('structuredResponse' in task.content)"
          :id="task.id"
          :task="task"
          :is-working="!taskWorkerWaiting && task.id === currentTask.id"
          style="min-width: 300px"
          :class="[
            'q-pa-xs',
            task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
          ]"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode } from '/home/tom/git/taskyon/frontend/src/modules/taskyon/types';
import Task from 'components/TaskWidget.vue';
import tyMarkdown from 'components/tyMarkdown.vue';
import { useQuasar } from 'quasar';
const $q = useQuasar();

defineProps<{
  selectedThread: TaskNode[];
  currentTask?: TaskNode;
  taskWorkerWaiting: boolean;
}>();
</script>

<style lang="sass">

.task-container
  display: flex
  flex-direction: column
  max-width: 800px
  margin: 0 auto // Centers the container

  // Default style for all tasks
  > div
    width: fit-content // Makes the width of the task as small as its content
    max-width: 99% // Prevents the task from growing beyond the container width
    box-sizing: border-box // Ensures padding and borders are included in width calculation
    align-self: flex-start // Aligns to the left by default

  // Specific style for tasks with the 'user' role
  .user
    align-self: flex-end // Aligns to the right

.user-message
  position: relative
.user-message::after
  content: ''
  position: absolute
  top: 0
  right: 0
  bottom: 0
  width: 5px /* Width of the fading effect */
  background: linear-gradient(to top, rgba(255, 255, 255, 0), $secondary)
</style>
