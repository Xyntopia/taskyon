<template>
  <div ref="threadElement" class="task-chat-thread column" data-cy="taskyon-chat-thread">
    <q-btn
      v-if="hiddenTaskCount > 0"
      flat
      dense
      no-caps
      class="task-chat-thread__load-older"
      data-cy="load-older-messages"
      :label="`Show ${hiddenTaskCount} older messages`"
      @click="loadOlderMessages"
    />
    <template v-for="{ task, index, previousTask, nextTask } in visibleTasks" :key="task.id">
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
      <slot
        v-else
        name="task"
        :task="task"
        :index="index"
        :previous-task="previousTask"
        :next-task="nextTask"
      >
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
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import TaskToolResultRow from './TaskToolResultRow.vue'
import TyMarkdown from '../tyMarkdown.vue'
import TaskChatMessage from './TaskChatMessage.vue'
import { selectTaskChatWindow, selectTasksVisibleInChat } from './taskChatVisibility'

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
    messageWindow?: number
  }>(),
  {
    pendingTask: undefined,
    tools: () => ({}),
    reasoning: undefined,
    hiddenTaskIds: () => new Set<string>(),
    showAllTasks: false,
    expertMode: false,
    presentation: () => ({}),
    messageWindow: 0,
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

const availableTasks = computed(() =>
  props.tasks.filter((task) => !props.hiddenTaskIds.has(task.id)),
)

const displayedTasks = computed(() =>
  props.showAllTasks
    ? availableTasks.value
    : selectTasksVisibleInChat(availableTasks.value, props.tools, props.expertMode),
)

const expandedMessages = ref(0)
watch(
  () => props.messageWindow,
  () => (expandedMessages.value = 0),
)
const windowedTasks = computed(() =>
  selectTaskChatWindow(
    displayedTasks.value,
    props.messageWindow > 0 ? props.messageWindow + expandedMessages.value : 0,
  ),
)
const hiddenTaskCount = computed(() => windowedTasks.value.hiddenCount)

const threadElement = ref<HTMLElement>()
const findScrollableParent = (element: HTMLElement | undefined) => {
  let parent = element?.parentElement ?? undefined
  while (parent) {
    const style = getComputedStyle(parent)
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent
    parent = parent.parentElement ?? undefined
  }
  return undefined
}
const loadOlderMessages = async () => {
  const container = findScrollableParent(threadElement.value)
  const anchor = threadElement.value?.querySelector<HTMLElement>('[data-task-id]')
  if (!container || !anchor) {
    expandedMessages.value += props.messageWindow
    return
  }
  const anchorTop = anchor.getBoundingClientRect().top
  expandedMessages.value += props.messageWindow
  await nextTick()
  const keepAnchorStable = () => {
    const delta = anchor.getBoundingClientRect().top - anchorTop
    if (delta !== 0) container.scrollTop += delta
  }
  keepAnchorStable()
  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(keepAnchorStable)
  observer.observe(threadElement.value as HTMLElement)
  window.setTimeout(() => observer.disconnect(), 500)
}

const visibleTasks = computed(() =>
  windowedTasks.value.tasks.map((task, index) => {
    const sourceIndex = availableTasks.value.indexOf(task)
    return {
      task,
      index,
      previousTask: availableTasks.value[sourceIndex - 1],
      nextTask: availableTasks.value[sourceIndex + 1],
    }
  }),
)
</script>

<style scoped lang="sass">
.task-chat-thread
  width: 100%
  align-items: center
  gap: 0.5rem
</style>
