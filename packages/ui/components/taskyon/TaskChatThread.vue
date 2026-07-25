<template>
  <div class="task-chat-thread column" data-cy="taskyon-chat-thread">
    <template v-for="{ task, index, nextTask } in visibleTasks" :key="task.id">
      <q-expansion-item v-if="reasoning?.get(task.id)" label="reasoning" dense class="text-caption">
        <TyMarkdown :src="reasoning.get(task.id) ?? ''" />
      </q-expansion-item>
      <slot name="task" :task="task" :index="index" :next-task="nextTask">
        <TaskChatMessage :task="task" />
      </slot>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode, ToolBase } from '@taskyon/taskyon'
import { computed } from 'vue'
import TyMarkdown from '../tyMarkdown.vue'
import TaskChatMessage from './TaskChatMessage.vue'
import { isTaskVisibleInChat } from './taskChatVisibility'

const props = withDefaults(
  defineProps<{
    tasks: readonly TaskNode[]
    tools?: Readonly<Record<string, ToolBase>>
    reasoning?: ReadonlyMap<string, string> | undefined
    hiddenTaskIds?: ReadonlySet<string>
    showAllTasks?: boolean
    expertMode?: boolean
  }>(),
  {
    tools: () => ({}),
    reasoning: undefined,
    hiddenTaskIds: () => new Set<string>(),
    showAllTasks: false,
    expertMode: false,
  },
)

const shouldShowTask = (task: TaskNode) => {
  if (props.hiddenTaskIds.has(task.id)) return false
  if (props.showAllTasks) return true
  return isTaskVisibleInChat(task, props.tools, props.expertMode)
}

const visibleTasks = computed(() =>
  props.tasks.flatMap((task, index) =>
    shouldShowTask(task)
      ? [
          {
            task,
            index,
            nextTask: props.tasks[index + 1],
          },
        ]
      : [],
  ),
)
</script>

<style scoped lang="sass">
.task-chat-thread
  width: 100%
  align-items: center
  gap: 0.5rem
</style>
