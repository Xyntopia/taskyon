<template>
  <section class="task-chat-window column no-wrap">
    <div ref="threadContainer" class="task-chat-window__thread col scroll q-pa-sm">
      <TaskChatThread
        v-if="selectedThread.length > 0"
        :tasks="selectedThread"
        :tools="allTools"
        :expert-mode="expertMode"
      >
        <template v-if="$slots.task" #task="slotProps">
          <slot name="task" v-bind="slotProps" />
        </template>
      </TaskChatThread>
      <div
        v-else-if="status === 'ready'"
        class="task-chat-window__empty fit column items-center justify-center text-center q-pa-md"
      >
        <div class="text-h6">{{ welcomeMessage }}</div>
      </div>
      <div v-else class="fit column items-center justify-center q-gutter-sm">
        <q-spinner v-if="status === 'starting'" color="primary" size="2rem" />
        <div :class="{ 'text-negative': status === 'error' }">
          {{ status === 'error' ? errorMessage : 'Starting Taskyon...' }}
        </div>
      </div>
    </div>
    <TaskComposer
      v-if="client && status === 'ready'"
      :client="client"
      :current-task="currentTask"
      :selected-task-id="selectedTaskId"
      :entry-node="entryNode"
      :all-tools="allTools"
      :min-mode="minMode"
      :expert-mode="expertMode"
      :show-web-search="showWebSearch"
      class="task-chat-window__composer q-pa-sm"
      @created="onTasksCreated"
    />
  </section>
</template>

<script setup lang="ts">
import type { partialTaskDraft, TaskNode, TaskyonClient, ToolBase } from '@taskyon/taskyon'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import TaskChatThread from './TaskChatThread.vue'
import TaskComposer from './TaskComposer.vue'

const props = withDefaults(
  defineProps<{
    client: TaskyonClient | undefined
    status?: 'starting' | 'ready' | 'error'
    errorMessage?: string
    entryNode: partialTaskDraft | undefined
    allTools?: Readonly<Record<string, ToolBase>>
    welcomeMessage?: string
    minMode?: boolean
    expertMode?: boolean
    showWebSearch?: boolean
  }>(),
  {
    status: 'starting',
    errorMessage: 'Taskyon could not be started.',
    allTools: () => ({}),
    welcomeMessage: 'How can I help?',
    minMode: false,
    expertMode: false,
    showWebSearch: false,
  },
)

const selectedTaskId = defineModel<string | undefined>('selectedTaskId', {
  default: undefined,
})
const selectedThread = ref<TaskNode[]>([])
const threadContainer = ref<HTMLElement>()
const currentTask = computed(() => selectedThread.value.at(-1) ?? null)
let unsubscribeTaskCreated: (() => void) | undefined
let refreshVersion = 0
let locallySelectedTaskId: string | undefined

const scrollToThreadEnd = async () => {
  await nextTick()
  const container = threadContainer.value
  if (container) container.scrollTop = container.scrollHeight
}

const refreshThread = async () => {
  const client = props.client
  const taskId = selectedTaskId.value
  const version = ++refreshVersion
  if (!client || !taskId) {
    selectedThread.value = []
    return
  }

  const tasks = await client.task.getChain({ id: taskId })
  if (version !== refreshVersion) return
  selectedThread.value = tasks
  await scrollToThreadEnd()
}

const trackCreatedTask = (task: TaskNode) => {
  const selectedId = selectedTaskId.value
  if (!selectedId) return

  const existingIndex = selectedThread.value.findIndex(({ id }) => id === task.id)
  const threadIds = new Set(selectedThread.value.map(({ id }) => id))
  const extendsThread =
    task.parentID === selectedId ||
    task.priorID === selectedId ||
    (task.parentID !== undefined && threadIds.has(task.parentID)) ||
    (task.priorID !== undefined && threadIds.has(task.priorID))
  if (existingIndex < 0 && task.id !== selectedId && !extendsThread) return

  if (existingIndex >= 0) {
    selectedThread.value = selectedThread.value.map((currentTask, index) =>
      index === existingIndex ? task : currentTask,
    )
  } else {
    selectedThread.value = [...selectedThread.value, task]
    if (selectedTaskId.value !== task.id) {
      locallySelectedTaskId = task.id
      selectedTaskId.value = task.id
    }
  }

  void scrollToThreadEnd()
}

const onSelectedTaskChanged = (taskId: string | undefined) => {
  if (taskId === locallySelectedTaskId) {
    locallySelectedTaskId = undefined
    return
  }
  locallySelectedTaskId = undefined
  void refreshThread()
}

const connectClient = (client: TaskyonClient | undefined) => {
  unsubscribeTaskCreated?.()
  unsubscribeTaskCreated = client?.task.onCreated(trackCreatedTask)
  void refreshThread()
}

const onTasksCreated = (taskId: string | undefined) => {
  if (taskId && !selectedTaskId.value) selectedTaskId.value = taskId
}

watch(() => props.client, connectClient, { immediate: true })
watch(selectedTaskId, onSelectedTaskChanged)
onBeforeUnmount(() => unsubscribeTaskCreated?.())
</script>

<style scoped lang="sass">
.task-chat-window
  min-width: 0
  min-height: 0
  height: 100%

.task-chat-window__thread
  min-height: 0

.task-chat-window__composer
  width: min(100%, 48rem)
  align-self: center
  flex: 0 0 auto

.task-chat-window__empty
  min-height: 12rem
</style>
