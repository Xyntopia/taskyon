<template>
  <div class="task-chat-thread column" data-cy="taskyon-chat-thread">
    <template v-for="{ task, index, nextTask } in visibleTasks" :key="task.id">
      <q-expansion-item v-if="reasoning?.get(task.id)" label="reasoning" dense class="text-caption">
        <TyMarkdown :src="reasoning.get(task.id) ?? ''" />
      </q-expansion-item>
      <slot name="task" :task="task" :index="index" :next-task="nextTask">
        <TaskChatMessage :task="task" :presentation="presentation" />
      </slot>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode, ToolBase } from '@taskyon/taskyon'
import type { TaskChatPresentation } from '@taskyon/ui/modules/taskChatPresentation'
import { computed } from 'vue'
import TyMarkdown from '../tyMarkdown.vue'
import TaskChatMessage from './TaskChatMessage.vue'
import { selectTasksVisibleInChat } from './taskChatVisibility'

const props = withDefaults(
  defineProps<{
    tasks: readonly TaskNode[]
    tools?: Readonly<Record<string, ToolBase>>
    reasoning?: ReadonlyMap<string, string> | undefined
    hiddenTaskIds?: ReadonlySet<string>
    showAllTasks?: boolean
    expertMode?: boolean
    presentation?: Partial<TaskChatPresentation>
  }>(),
  {
    tools: () => ({}),
    reasoning: undefined,
    hiddenTaskIds: () => new Set<string>(),
    showAllTasks: false,
    expertMode: false,
    presentation: () => ({}),
  },
)

const displayedTasks = computed(() => {
  const tasks = props.tasks.filter((task) => !props.hiddenTaskIds.has(task.id))
  return props.showAllTasks ? tasks : selectTasksVisibleInChat(tasks, props.tools, props.expertMode)
})

const visibleTasks = computed(() =>
  displayedTasks.value.map((task, index) => ({
    task,
    index,
    nextTask: displayedTasks.value[index + 1],
  })),
)
</script>

<style scoped lang="sass">
.task-chat-thread
  width: 100%
  align-items: center
  gap: 0.5rem
</style>
