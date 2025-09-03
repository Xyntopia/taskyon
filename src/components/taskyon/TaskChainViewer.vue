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
          short
          :class="[
            prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
            prop.node.task.role,
            Object.keys(prop.node.task.content)[0],
          ]"
          :show-meta="!!showIds"
          @click.stop
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
          short
          :class="[
            prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
            prop.node.task.role,
            Object.keys(prop.node.task.content)[0],
          ]"
          :show-meta="!!showIds"
          @click.stop
        />
      </template>
    </q-tree>
    <template v-else>
      <template v-for="(task, idx) in props.selectedThread" :key="task.id">
        <q-expansion-item
          v-if="reasoning.get(task.id)"
          label="reasoning"
          dense
          class="text-caption"
        >
          <tyMarkdown :src="reasoning.get(task.id)!" />
        </q-expansion-item>
        <Task
          v-if="showAllTasks || showTask(task)"
          :id="task.id"
          :class="[task.role, task.content.type]"
          :task="task"
          :previous-task="props.selectedThread[idx - 1]"
          :next-task="props.selectedThread[idx + 1]"
          :is-working="isProcessing(task.id)"
          :show-meta="!!showIds"
        />
      </template>
    </template>
    <!--Render tasks which are in progress-->
    <div class="task-logs q-py-sm">
      <template
        v-if="
          currentMessageStream?.length === 0 &&
          currentThinkingStream &&
          currentThinkingStream.length > 0
        "
      >
        <div class="text-caption">THINKING:</div>
        <div
          ref="thinkingContainer"
          style="font-size: 0.8rem; max-height: 300px; overflow-y: auto"
          @scroll="handleUserScroll"
        >
          <tyMarkdown
            no-line-numbers
            no-mermaid
            :src="currentThinkingStream /*?.split('\n').slice(-30).join('\n')*/"
            class="text-caption"
          />
        </div>
      </template>
      <q-card v-if="isProcessing(currentTask.id)" class="row" flat>
        <div class="col">
          <tyMarkdown
            v-if="currentMessageStream"
            no-line-numbers
            no-mermaid
            :src="currentMessageStream || ''"
          />
          <div>
            {{ safeYamlDump(currentFunctionStream) }}
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
import type { TaskNode, Unsubscribe } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import { accumulateStep } from 'src/modules/taskyon/chat'
import { type TaskTreeNode } from 'src/modules/taskyon/taskManager'
import type { ChatResponseType } from 'src/modules/taskyon/types'
import { asyncComputed } from 'src/modules/vueUtils'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { getReasoning, useTaskyonStore } from 'src/stores/taskyonState'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const tystate = useTaskyonStore()
const showLogs = ref(false)

const lastWorkerEvent = computed(() => {
  return tystate.workerStreamLogs.at(-1)
})

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
        if (meta) {
          const reason = getReasoning(meta)
          if (reason) reasoning.value.set(t.id, reason)
        }
      }),
    )
  },
  { immediate: true },
)

const isProcessing = (id: string) => {
  const lts = tystate.lastTaskState.get(id)
  if (lts) return lts !== 'processed' && lts !== 'all finished' && lts !== 'aborted'
  else return false
}

const streamingTracker = ref<Map<string, ChatResponseType>>(new Map())

let streamerUnsubscriber: Unsubscribe

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

void tystate.chatCompletionStream
  .subscribe(({ taskId, chunk }) => {
    if (!chunk) return
    const currentStream = streamingTracker.value.get(taskId)
    const updatedStream = accumulateStep(currentStream, chunk)
    streamingTracker.value.set(taskId, updatedStream)
  })
  .then((unsubscribe) => (streamerUnsubscriber = unsubscribe))

onBeforeUnmount(() => {
  streamerUnsubscriber()
})

const currentMessageStream = computed(() => {
  if (props.currentTask)
    return streamingTracker.value.get(props.currentTask.id)?.choices?.[0]?.message?.content || ''
  else return undefined
})

const currentThinkingStream = computed(() => {
  if (props.currentTask) {
    return streamingTracker.value.get(props.currentTask.id)?.choices?.[0]?.reasoning || ''
  } else return undefined
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
  () => currentThinkingStream.value,
  async () => {
    // This will run whenever currentThinkingStream changes
    if (currentThinkingStream.value && shouldAutoScroll.value) {
      await nextTick()
      if (thinkingContainer.value) {
        //console.log('scrolling!!', thinkingContainer.value.scrollHeight)
        thinkingContainer.value.scrollTop = thinkingContainer.value.scrollHeight
      }
    }
  },
)

const currentFunctionStream = computed(() => {
  if (props.currentTask)
    return streamingTracker.value.get(props.currentTask.id)?.choices?.[0]?.message?.tool_calls?.[0]
      ?.function
  else return undefined
})

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
  const tm = await tystate.getTaskManager()

  const { task, children } = await tm.buildTaskTreeNode(taskID, 1)

  const childrenTrees = tyChain2QTree(children)

  if (justChildren) return childrenTrees

  const siblings = await tm.buildSiblingChain(taskID, 1)
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

function showTask(t: TaskNode) {
  //console.log('showTask')
  // in our settings we should be able to specify which tasktypes to hide!
  let showInChat = true
  if (t.content.type === 'functioncall') {
    showInChat = !tystate.allTools[t.content.data.name]?.renderOptions?.hideChat
  }
  const showType = !['return'].includes(t.content.type)
  const showExpert = t.content.type === 'structured' ? props.expertMode : true
  return showExpert && showType && showInChat
}
</script>
