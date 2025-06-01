<template>
  <div class="col q-px-xs" style="background-color: inherit; color: inherit" flat square>
    <template v-if="currentTask">
      <!--<pre>{{ JSON.stringify(taskTree, undefined, 2) }}</pre>-->
      <div v-if="taskTreeRoot" class="tasks-container q-pa-sm q-pl-md">
        <q-tree
          dense
          node-key="taskid"
          :nodes="taskTree"
          default-expand-all
          @lazy-load="onLazyLoad"
        >
          <template #default-header="prop">
            <q-card
              v-if="prop.node.task"
              class="task-container"
              flat
              :class="[prop.node.task.role, Object.keys(prop.node.task.content)[0]]"
              @click.stop
            >
              <Task
                :id="prop.node.task.id"
                :task="prop.node.task"
                short
                :class="[prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
                :show-id="!!showIds"
              />
            </q-card>
            <div v-else class="text-bold">{{ prop.node.taskid.slice(0, 12) }}</div>
          </template>
        </q-tree>
      </div>
      <div v-else-if="showHierarchy" class="tasks-container q-pa-sm q-pl-md">
        <q-tree dense node-key="taskid" :nodes="taskHierarchy" default-expand-all>
          <template #default-header="prop">
            <q-card
              class="task-container"
              flat
              :class="[prop.node.task.role, Object.keys(prop.node.task.content)[0]]"
              @click.stop
            >
              <Task
                :id="prop.node.task.id"
                :task="prop.node.task"
                short
                :class="[prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
                :show-id="!!showIds"
              />
            </q-card>
          </template>
        </q-tree>
      </div>
      <div v-else class="q-gutter-xs tasks-container col items-center">
        <template v-for="(task, idx) in props.selectedThread">
          <div
            v-if="showAllTasks || showTask(task)"
            :key="task.id"
            :class="`row ${task.role === 'user' ? 'justify-end' : ''}`"
          >
            <q-card flat :class="[task.role, task.content.type, 'task-container']">
              <Task
                :id="task.id"
                :task="task"
                :previous-task="props.selectedThread[idx - 1]"
                :next-task="props.selectedThread[idx + 1]"
                :is-working="
                  !!tystate.lastTaskState.get(task.id) &&
                  tystate.lastTaskState.get(task.id) !== 'processed'
                "
                :show-id="!!showIds"
              />
            </q-card>
          </div>
        </template>
      </div>
      <!--Render tasks which are in progress-->
      <div class="task-logs tasks-container q-py-sm">
        <q-card
          v-if="
            !!tystate.lastTaskState.get(currentTask.id) &&
            tystate.lastTaskState.get(currentTask.id) !== 'processed'
          "
          class="row"
          flat
        >
          <div class="col">
            <tyMarkdown
              v-if="currentMessageStream"
              no-line-numbers
              no-mermaid
              :use-iframe="false"
              :src="currentMessageStream || ''"
            />
            <div>
              {{ safeYamlDump(currentFunctionStream) }}
            </div>
            <q-spinner-dots size="2rem" color="secondary" />
          </div>
        </q-card>
        <div class="row items-center" v-if="lastWorkerEvent && tystate.workerStreamLogs.length > 0">
          <q-btn flat dense no-caps :icon-right="matArrowDropDown" @click="showLogs = !showLogs">
            <span
              style="
                max-width: 200px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              "
              class="text-caption text-weight-light"
            >
              {{ lastWorkerEvent.stage !== 'all finished' ? 'Processing:' : ''
              }}{{ lastWorkerEvent?.stage }}
              {{ lastWorkerEvent?.taskId || lastWorkerEvent?.task?.id }}
            </span>
          </q-btn>
        </div>
        <template v-if="showLogs">
          <div
            v-for="(log, ridx) in tystate.workerStreamLogs.toReversed()"
            class="column"
            :key="ridx"
          >
            {{ formatTimeStamp(log.timestamp) }} {{ log.stage
            }}{{ log.info ? ': ' + log.info : '' }}
          </div></template
        >
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ChatResponseType, TaskNode } from 'src/modules/taskyon/types'
import Task from 'components/taskyon/TaskWidget.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount } from 'vue'
import { ref } from 'vue'
import { type TaskTreeNode } from 'src/modules/taskyon/taskManager'
import type { Unsubscribe } from 'src/modules/frpBus'
import { matArrowDropDown } from '@quasar/extras/material-icons'
import { accumulateStep } from 'src/modules/taskyon/chat'
import { safeYamlDump } from 'src/modules/yamlUtils'

const tystate = useTaskyonStore()
const showLogs = ref(false)

const lastWorkerEvent = computed(() => {
  return tystate.workerStreamLogs.at(-1)
})

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask?: TaskNode | undefined | null
  showAllTasks?: boolean
  showHierarchy?: boolean
  taskTreeRoot?: string | undefined
  showIds?: boolean
  expertMode?: boolean
}>()

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

// TODO: move this "one layer up" :)
const toolList = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  const toolList = await tm.updateToolDefinitions()
  return toolList
}, undefined)

function showTask(t: TaskNode) {
  //console.log('showTask')
  const noHideLabel = !(t.label ? t.label.includes('hide') : false) // TODO: hide tasks based on level as well :)
  let showInChat = true
  if (t.content.type === 'functioncall') {
    if (toolList.value) showInChat = !toolList.value[t.content.data.name]?.renderOptions?.hideChat
    else if (t.content.data.name === 'chatCompletion') showInChat = false
  }
  const showType = !['return', 'toolresult'].includes(t.content.type)
  const showExpert = t.content.type === 'structured' ? props.expertMode : true
  return showExpert && showType && showInChat && noHideLabel
}
</script>
