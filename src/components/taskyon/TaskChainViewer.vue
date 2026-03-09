<template>
  <div class="tasks-container">
    <!--if we want to see the task tree-->
    <q-tree
      v-if="taskTreeRoot"
      dense
      node-key="taskid"
      :nodes="taskTree"
      default-expand-all
      @lazy-load="onLazyLoad"
    >
      <template #default-header="prop">
        <Task
          v-if="prop.node.task"
          :id="prop.node.task.id"
          :task="prop.node.task"
          :message-debug="!!state.messageDebug[prop.node.task.id]"
          short
          :class="[
            prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
            prop.node.task.role,
            Object.keys(prop.node.task.content)[0],
          ]"
          :show-meta="!!showIds"
          @click.stop
          @update:message-debug="(value) => (state.messageDebug[prop.node.task.id] = value)"
        />
        <div v-else class="text-bold">{{ prop.node.taskid.slice(0, 12) }}</div>
      </template>
    </q-tree>
    <!--if we want to see debug view-->
    <q-tree
      v-else-if="showHierarchy"
      dense
      node-key="taskid"
      :nodes="taskHierarchy"
      default-expand-all
    >
      <template #default-header="prop">
        <Task
          :id="prop.node.task.id"
          :task="prop.node.task"
          :message-debug="!!state.messageDebug[prop.node.task.id]"
          short
          :class="[
            prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
            prop.node.task.role,
            Object.keys(prop.node.task.content)[0],
          ]"
          :show-meta="!!showIds"
          @click.stop
          @update:message-debug="(value) => (state.messageDebug[prop.node.task.id] = value)"
        />
      </template>
    </q-tree>
    <!--render the "normal" task view...-->
    <SimpleChatView
      v-else
      :show-all-tasks="showAllTasks"
      :reasoning="reasoning"
      :is-processing="isProcessing"
      :show-ids="showIds"
      :selected-thread="selectedThread"
      :expert-mode="expertMode"
    />
    <!--Render tasks which are in progress-->
    <div class="task-logs q-py-sm">
      <template v-if="currentMsgStream && currentMsgStream.reasoning.length > 0">
        <div class="text-caption">THINKING:</div>
        <div
          ref="thinkingContainer"
          style="font-size: 0.8rem; max-height: 300px; overflow-y: auto"
          @scroll="handleUserScroll"
        >
          <tyMarkdown
            no-line-numbers
            no-mermaid
            :src="currentMsgStream.reasoning /*?.split('\n').slice(-30).join('\n')*/"
            class="text-caption"
          />
        </div>
      </template>
      <q-card v-if="isProcessing(currentTask.id)" class="row" flat>
        <div class="col">
          <tyMarkdown
            v-if="currentMsgStream && currentMsgStream.text.length > 0"
            no-line-numbers
            no-mermaid
            :src="currentMsgStream.text || ''"
          />
          <div v-if="currentMsgStream?.func">
            {{ currentMsgStream.func }}
          </div>
          <q-spinner-dots size="2rem" color="secondary" />
        </div>
      </q-card>
      <div v-if="lastWorkerEvent && tystate.workerStreamLogs.length > 0" class="row items-center">
        <q-btn flat dense no-caps :icon-right="matArrowDropDown" @click="showLogs = !showLogs">
          <span
            style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
            class="text-caption text-weight-light"
          >
            {{ lastWorkerEvent.stage !== 'all finished' ? 'Processing:' : ''
            }}{{ lastWorkerEvent?.stage }}
            {{ lastWorkerEvent?.info }}
          </span>
        </q-btn>
      </div>
      <template v-if="showLogs">
        <div
          v-for="(log, ridx) in tystate.workerStreamLogs.toReversed()"
          :key="ridx"
          class="column"
        >
          {{ formatTimeStamp(log.timestamp) }} : {{ log.stage }}
          {{ log.info ? ' | ' + log.info : '' }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matArrowDropDown } from '@quasar/extras/material-icons'
import tyMarkdown from '@taskyon/shared/components/tyMarkdown.vue'
import type { TaskTreeNode } from '@taskyon/taskyon'
import { type TaskNode } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import SimpleChatView from './SimpleChatView.vue'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const showLogs = ref(false)

const lastWorkerEvent = computed(() => {
  return tystate.workerStreamLogs.at(-1)
})

const emit = defineEmits<{
  (e: 'onSizeChange'): void
}>()

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask: TaskNode
  showAllTasks?: boolean
  showHierarchy?: boolean
  taskTreeRoot?: string | undefined
  showIds?: boolean
  expertMode?: boolean
}>()

const reasoning = ref(new Map<string, string>())
watch(
  () => props.currentTask.id,
  () => {
    console.log('re-calculate reason lists!')
    reasoning.value.clear()
    void Promise.all(
      props.selectedThread.map(async (t) => {
        const meta = await tystate.getMeta(t.id)
        if (meta?.reasoning) {
          reasoning.value.set(t.id, meta.reasoning)
        }
      }),
    )
  },
  { immediate: true },
)

// emit onSizeChange events, if our thread changes!
watch(
  () => props.selectedThread.map((t) => t.id),
  async () => {
    await nextTick()
    emit('onSizeChange')
  },
)

const isProcessing = (id: string) => {
  const lts = tystate.lastTaskState.get(id)
  if (!lts) return false
  return !['processed', 'all finished', 'aborted', 'error'].includes(lts)
}

function formatTimeStamp(timestamp: string | number | Date): string {
  const date = new Date(timestamp)
  const now = new Date()
  const elapsedMs = now.getTime() - date.getTime()

  const seconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(elapsedMs / (1000 * 60))
  const hours = Math.floor(elapsedMs / (1000 * 60 * 60))

  if (minutes < 5) {
    return `${minutes > 0 ? `${minutes}m ` : ''}${seconds % 60}s ago`
  } else if (minutes < 60) {
    return `${minutes}m ago`
  } else if (hours < 24) {
    return `${hours}h ago`
  } else {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}

const streamingTracker = ref<
  Map<
    string,
    {
      text: string
      reasoning: string
      func: string
    }
  >
>(new Map())
const currentMsgStream = computed(() => {
  return streamingTracker.value.get(props.currentTask.id)
})

const streamerUnsubscriber = tystate.chatCompletionStream(({ taskId, chunk }) => {
  if (!chunk) return
  let currentStream = streamingTracker.value.get(taskId)
  if (!currentStream) {
    currentStream = {
      text: '',
      reasoning: '',
      func: '',
    }
    streamingTracker.value.set(taskId, currentStream)
  }

  switch (chunk.type) {
    case 'text-delta':
      currentStream.text += chunk.text
      break
    case 'reasoning-delta':
      currentStream.reasoning += chunk.text
      break
    case 'tool-input-delta':
      currentStream.func += chunk.delta
      break
  }

  emit('onSizeChange')
})

onBeforeUnmount(() => {
  streamerUnsubscriber()
})

const thinkingContainer = ref<HTMLElement>()
const shouldAutoScroll = ref(true)
const handleUserScroll = () => {
  if (!thinkingContainer.value) return

  const { scrollTop, scrollHeight, clientHeight } = thinkingContainer.value
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 20 // 20px tolerance

  // If user scrolled away from bottom, disable auto-scroll
  // If user scrolled back to bottom, re-enable auto-scroll
  shouldAutoScroll.value = isAtBottom
}

watch(
  () => streamingTracker.value.get(props.currentTask.id)?.reasoning,
  async (reason) => {
    // This will run whenever currentThinkingStream changes
    if (reason && shouldAutoScroll.value) {
      await nextTick()
      if (thinkingContainer.value) {
        //console.log('scrolling!!', thinkingContainer.value.scrollHeight)
        thinkingContainer.value.scrollTop = thinkingContainer.value.scrollHeight
      }
    }
  },
)

interface taskTreeNodeType {
  label: string
  taskid: string // in the case of subchains, its the id of the first task in that chain
  task?: TaskNode
  children?: taskTreeNodeType[]
  lazy?: boolean
}

const taskHierarchy = computed(() => {
  let taskTree = [] as taskTreeNodeType[]
  let nextDirectChildren = [] as taskTreeNodeType[]

  if (!props.taskTreeRoot) {
    for (const task of props.selectedThread.toReversed()) {
      const taskobj = {
        label: task.name || task.id.toString().slice(-5),
        taskid: task.id,
        task,
        children: nextDirectChildren,
        lazy: task.content.type === 'functioncall',
      }
      if (task.priorID) {
        taskTree = [taskobj, ...taskTree]
        nextDirectChildren = []
      } else if (!task.priorID && task.parentID) {
        nextDirectChildren = [taskobj, ...taskTree]
        taskTree = []
      } else {
        taskTree = [taskobj, ...taskTree]
      }
    }
  }

  return taskTree
})

const tyList2QTree = (tasklist: TaskTreeNode[]) =>
  tasklist.map((ttn) => ({
    label: ttn.task.name || ttn.task.id.toString().slice(-5),
    taskid: ttn.task.id,
    task: ttn.task,
    // we can only have expandable subchains, if our tasks are a "functioncall"
    lazy: ttn.task.content.type === 'functioncall',
  })) as taskTreeNodeType[]

const tyChain2QTree = (taskChain: TaskTreeNode[][]) => {
  if (taskChain.length > 1) {
    return taskChain.map((tc) => ({
      label: `SubChain ${tc[0]?.task.id.slice(0, 3)}`,
      taskid: `SubChain ${tc[0]?.task.id}`,
      children: tyList2QTree(tc),
      lazy: false,
    })) as taskTreeNodeType[]
  } else if (taskChain.length === 1) {
    return tyList2QTree(taskChain[0]!)
  } else {
    return []
  }
}

const getQTree = async (taskID: string, justChildren = false) => {
  const ty = await tystate.taskyon

  const { task, children } = await ty.buildTaskTreeNode(taskID, 1)

  const childrenTrees = tyChain2QTree(children)

  if (justChildren) return childrenTrees

  const siblings = await ty.buildSiblingChain(taskID, 1)
  const siblingNodes = tyList2QTree(siblings)

  const taskTree: taskTreeNodeType[] = [
    {
      label: task.name || task.id.toString().slice(-5),
      taskid: task.id,
      task,
      children: childrenTrees,
    },
  ]

  taskTree.push(...siblingNodes.slice(1))
  return taskTree
}

const taskTree = asyncComputed<taskTreeNodeType[]>(async () => {
  if (props.taskTreeRoot) {
    const taskTree = await getQTree(props.taskTreeRoot)

    return taskTree
  }

  return []
}, [])

async function onLazyLoad({
  /*node,*/
  key,
  done,
  /*fail,*/
}: {
  node: unknown
  done: (children?: readonly unknown[]) => void
  key: string
  fail: unknown
}) {
  // call fail() if any error occurs

  const subTaskTree = await getQTree(key, true)

  done(subTaskTree)
}
</script>

<style lang="sass">
.task-container
  position: relative

  &:not(:has(.markdown-iframe))
    .task-safety-icon
      display: none

  // TODO: show icon on the right if assistant, and left if user....
  .task-safety-icon
    position: absolute
    top: -12px
    right: 0px
    width: 0.8em
    height: 0.8em
    z-index: 9
</style>
