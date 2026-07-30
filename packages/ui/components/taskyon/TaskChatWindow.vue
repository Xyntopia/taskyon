<template>
  <section class="task-chat-window column no-wrap">
    <header class="task-chat-window__header row items-center no-wrap q-px-sm">
      <div class="task-chat-window__identity row items-center no-wrap">
        <q-icon :name="resolvedPresentation.assistantIcon" size="1.2rem" />
        <span class="text-subtitle2">{{ resolvedPresentation.assistantLabel }}</span>
      </div>
      <q-space />
      <CopyTaskChatButton
        v-if="copyableThread.length > 0"
        flat
        round
        dense
        :tasks="copyableThread"
      />
      <q-btn
        flat
        round
        dense
        :icon="mdiForumOutline"
        :disable="!client || status !== 'ready'"
        :aria-label="resolvedPresentation.recentChatsLabel"
      >
        <q-tooltip>{{ resolvedPresentation.recentChatsLabel }}</q-tooltip>
        <q-menu anchor="bottom right" self="top right">
          <TaskConversationBrowser
            v-if="client"
            :client="client"
            :conversation-ids="recentTaskIds"
            :selected-task-id="selectedTaskId"
            :presentation="presentation"
            @select="selectConversation"
            @new="startNewConversation"
          />
        </q-menu>
      </q-btn>
      <q-btn
        flat
        round
        dense
        :icon="mdiForumPlus"
        :disable="!client || status !== 'ready'"
        aria-label="start new chat"
        @click="startNewConversation"
      >
        <q-tooltip>{{ resolvedPresentation.newChatLabel }}</q-tooltip>
      </q-btn>
    </header>
    <div ref="threadContainer" class="task-chat-window__thread col scroll q-pa-sm">
      <TaskChatThread
        v-if="selectedThread.length > 0"
        :tasks="selectedThread"
        :tools="allTools"
        :expert-mode="expertMode"
        :presentation="presentation"
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
          {{ status === 'error' ? errorMessage : resolvedPresentation.startingMessage }}
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
      :placeholder="resolvedPresentation.composerPlaceholder"
      class="task-chat-window__composer q-pa-sm"
      @created="onTasksCreated"
    />
  </section>
</template>

<script setup lang="ts">
import { mdiForumOutline, mdiForumPlus } from '@quasar/extras/mdi-v6'
import {
  type partialTaskDraft,
  type TaskNode,
  type TaskyonClient,
  type ToolBase,
} from '@taskyon/taskyon'
import { useConversationHistory } from '@taskyon/ui/modules/useConversationHistory'
import {
  resolveTaskChatPresentation,
  type TaskChatPresentation,
} from '@taskyon/ui/modules/taskChatPresentation'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CopyTaskChatButton from './CopyTaskChatButton.vue'
import TaskConversationBrowser from './TaskConversationBrowser.vue'
import TaskChatThread from './TaskChatThread.vue'
import TaskComposer from './TaskComposer.vue'
import { selectTasksForChatCopy } from './taskChatVisibility'

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
    presentation?: Partial<TaskChatPresentation>
  }>(),
  {
    status: 'starting',
    errorMessage: 'Taskyon could not be started.',
    allTools: () => ({}),
    welcomeMessage: 'How can I help?',
    minMode: false,
    expertMode: false,
    showWebSearch: false,
    presentation: () => ({}),
  },
)

const selectedTaskId = defineModel<string | undefined>('selectedTaskId', {
  default: undefined,
})
const recentTaskIds = defineModel<string[]>('recentTaskIds', { default: () => [] })
const selectedThread = ref<TaskNode[]>([])
const threadContainer = ref<HTMLElement>()
const currentTask = computed(() => selectedThread.value.at(-1) ?? null)
const copyableThread = computed(() =>
  selectTasksForChatCopy(selectedThread.value, props.allTools, props.expertMode),
)
let unsubscribeTaskCreated: (() => void) | undefined
let refreshVersion = 0
let locallySelectedTaskId: string | undefined

const resolvedPresentation = computed(() => resolveTaskChatPresentation(props.presentation))
const conversationHistory = useConversationHistory({
  history: recentTaskIds,
  getClient: () => props.client?.task,
  onError: (error) => console.warn('Could not update conversation history.', error),
})

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
  const selectedTask = tasks.find(({ id }) => id === taskId) ?? tasks.at(-1)
  if (selectedTask) void conversationHistory.record(selectedTask)
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
    void conversationHistory.record(task)
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
  if (!taskId) return
  if (!selectedTaskId.value) selectedTaskId.value = taskId
  void props.client?.task.get({ id: taskId }).then((task) => {
    if (task) void conversationHistory.record(task)
  })
}

const selectConversation = (taskId: string) => {
  selectedTaskId.value = taskId
}

const startNewConversation = () => {
  refreshVersion += 1
  locallySelectedTaskId = undefined
  selectedThread.value = []
  selectedTaskId.value = undefined
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

.task-chat-window__header
  min-height: 2.5rem
  flex: 0 0 2.5rem

.task-chat-window__identity
  min-width: 0
  gap: 0.4rem

.task-chat-window__composer
  width: min(100%, 48rem)
  align-self: center
  flex: 0 0 auto

.task-chat-window__empty
  min-height: 12rem
</style>
