<template>
  <div class="task-chat-thread column" data-cy="taskyon-chat-thread">
    <template v-for="{ task, index, nextTask } in visibleTasks" :key="task.id">
      <q-expansion-item v-if="reasoning?.get(task.id)" label="reasoning" dense class="text-caption">
        <TyMarkdown :src="reasoning.get(task.id) ?? ''" />
      </q-expansion-item>
      <TaskToolResultRow
        v-if="client && selectedTaskId && task.content.type === 'functioncall'"
        :task="task"
        :revision="revision"
        :selection-id="selectedTaskId"
        :load-results="loadResults"
      />
      <slot v-else name="task" :task="task" :index="index" :next-task="nextTask">
        <TaskChatMessage :task="task" :presentation="presentation" />
      </slot>
    </template>
    <TaskChatMessage
      v-if="pendingTask"
      :task="pendingTask"
      :presentation="presentation"
      data-cy="pending-chat-message"
    />
  </div>
</template>

<script setup lang="ts">
import type { partialTaskDraft, TaskNode, ToolBase, TaskyonClient } from '@taskyon/taskyon/api'
import type { TaskChatPresentation } from '@taskyon/ui/modules/taskChatPresentation'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import TaskToolResultRow from './TaskToolResultRow.vue'
import TyMarkdown from '../tyMarkdown.vue'
import TaskChatMessage from './TaskChatMessage.vue'
import { selectTasksVisibleInChat } from './taskChatVisibility'

const props = withDefaults(
  defineProps<{
    tasks: readonly TaskNode[]
    pendingTask?: partialTaskDraft | undefined
    client?: TaskyonClient | undefined
    selectedTaskId?: string | undefined
    tools?: Readonly<Record<string, ToolBase>>
    reasoning?: ReadonlyMap<string, string> | undefined
    hiddenTaskIds?: ReadonlySet<string>
    showAllTasks?: boolean
    expertMode?: boolean
    presentation?: Partial<TaskChatPresentation>
  }>(),
  {
    pendingTask: undefined,
    tools: () => ({}),
    reasoning: undefined,
    hiddenTaskIds: () => new Set<string>(),
    showAllTasks: false,
    expertMode: false,
    presentation: () => ({}),
  },
)

const revision = ref(0)
let unsubscribe: (() => void) | undefined
watch(
  () => props.client,
  (client) => {
    unsubscribe?.()
    unsubscribe = client?.taskModel.subscribe(() => revision.value++)
  },
  { immediate: true },
)
onBeforeUnmount(() => unsubscribe?.())
let active = 0
const waiting: Array<() => void> = []
const loadResults = async (id: string, priority: boolean) => {
  const client = props.client
  const selectedId = props.selectedTaskId
  if (!client || !selectedId) return []
  if (active >= 2)
    await new Promise<void>((resolve) => {
      if (priority) waiting.unshift(resolve)
      else waiting.push(resolve)
    })
  else active++
  try {
    return await client.taskModel.loadResults(id, selectedId)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

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
