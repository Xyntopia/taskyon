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
          :is-working="isProcessing(prop.node.task.id)"
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
          :is-working="isProcessing(prop.node.task.id)"
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
      :hidden-task-ids="queuedVisibleTaskIds"
    />
    <q-expansion-item
      v-if="queuedTaskCount > 0"
      dense
      header-class="text-caption text-weight-medium"
      class="task-queue"
      :label="queueSummary"
    >
      <div
        v-for="branch in queuedDisplayBranches"
        :key="branch.tasks[0]?.id"
        class="task-queue-branch"
      >
        <button
          type="button"
          class="task-queue-branch-button"
          @click="selectQueueBranch(branch.tasks)"
        >
          <span class="task-queue-branch-label">{{ queueBranchLabel(branch.tasks) }}</span>
          <span class="text-caption text-weight-light">{{ queueBranchStatus(branch) }}</span>
        </button>
        <ul class="task-queue-list">
          <li v-for="task in branch.pendingTasks" :key="task.id">
            {{ getTaskQueueLabel(task) }}
          </li>
        </ul>
      </div>
    </q-expansion-item>
    <!--Render tasks which are in progress-->
    <div class="task-logs q-py-sm">
      <TaskExecutionProgress v-if="currentExecutionProgress" :progress="currentExecutionProgress" />
      <div v-if="lastWorkerEvent && tystate.workerStreamLogs.length > 0" class="row items-center">
        <q-btn flat dense no-caps :icon-right="matArrowDropDown" @click="showLogs = !showLogs">
          <span
            style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
            class="text-caption text-weight-light"
          >
            {{ lastWorkerEvent.stage !== 'all processed' ? 'Processing:' : ''
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
import TaskExecutionProgress from '@taskyon/ui/components/taskyon/TaskExecutionProgress.vue'
import { selectTaskExecutionProgress } from '@taskyon/ui/modules/taskExecutionProgress'
import { useTaskExecutionProgress } from '@taskyon/ui/modules/useTaskExecutionProgress'
import {
  getTaskQueueLabel,
  selectSiblingTaskChain,
  selectTaskQueueBranches,
  type TaskNode,
  type TaskQueueBranch,
} from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { selectTasksVisibleInChat } from '@taskyon/ui/components/taskyon/taskChatVisibility'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, nextTick, ref, watch } from 'vue'
import SimpleChatView from './SimpleChatView.vue'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const showLogs = ref(false)
const executionProgress = useTaskExecutionProgress(
  tystate.chatCompletionStream,
  tystate.workerStream,
)

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

const taskById = computed(() => new Map(props.selectedThread.map((task) => [task.id, task])))

const siblingTaskChain = computed(() => selectSiblingTaskChain(props.selectedThread))

const relatedTaskChains = asyncComputed<TaskNode[][]>(
  async () => {
    const childChains = await Promise.all(
      props.selectedThread
        .filter((task) => task.content.type === 'functioncall')
        .map((task) => tystate.taskyonClient.task.getChildChains({ id: task.id })),
    )
    return [siblingTaskChain.value, ...childChains.flat()]
  },
  [],
  () => [tystate.taskTreeRevision, ...props.selectedThread.map((task) => task.id)],
)

const queueBranches = computed(() =>
  selectTaskQueueBranches(relatedTaskChains.value, tystate.lastTaskState),
)

const queuedDisplayBranches = computed(() =>
  queueBranches.value
    .map((branch) => {
      const visibleTaskIds = new Set(
        selectTasksVisibleInChat(branch.tasks, tystate.allTools, props.expertMode ?? false).map(
          ({ id }) => id,
        ),
      )
      return {
        ...branch,
        pendingTasks: branch.pendingTasks.filter(({ id }) => visibleTaskIds.has(id)),
        activeTasks: branch.activeTasks.filter(({ id }) => visibleTaskIds.has(id)),
      }
    })
    .filter((branch) => branch.pendingTasks.length > 0),
)

const queuedVisibleTaskIds = computed(
  () =>
    new Set(
      queuedDisplayBranches.value.flatMap((branch) => branch.pendingTasks.map(({ id }) => id)),
    ),
)

const queuedTaskCount = computed(() =>
  queuedDisplayBranches.value.reduce((count, branch) => count + branch.pendingTasks.length, 0),
)

const queueSummary = computed(() => {
  const taskLabel = `${queuedTaskCount.value} ${queuedTaskCount.value === 1 ? 'task' : 'tasks'} queued`
  return queuedDisplayBranches.value.length > 1
    ? `${queuedDisplayBranches.value.length} branches · ${taskLabel}`
    : taskLabel
})

const queueBranchLabel = (tasks: readonly TaskNode[]) => {
  const task = selectTasksVisibleInChat(tasks, tystate.allTools, props.expertMode ?? false).at(0)
  return task ? getTaskQueueLabel(task) : 'Queued branch'
}

const queueBranchStatus = (branch: TaskQueueBranch) =>
  branch.activeTasks.length > 0
    ? 'running'
    : `${branch.pendingTasks.length} ${branch.pendingTasks.length === 1 ? 'task' : 'tasks'} queued`

const selectQueueBranch = (tasks: readonly TaskNode[]) => {
  state.navigateToTask(tasks.at(-1)?.id)
}

const isSameTaskOrDescendant = (taskId: string, candidateId: string) => {
  if (candidateId === taskId) return true
  let cursor = taskById.value.get(candidateId)
  while (cursor?.parentID) {
    if (cursor.parentID === taskId) return true
    cursor = taskById.value.get(cursor.parentID)
  }
  return false
}

const isTaskActive = (id: string) => {
  const lts = tystate.lastTaskState.get(id)
  if (!lts) return false
  return !['processed', 'finished', 'all processed', 'aborted', 'error'].includes(lts)
}

const isProcessing = (id: string) =>
  isTaskActive(id) ||
  [...tystate.activeTaskIds].some((activeId) => isSameTaskOrDescendant(id, activeId))

const currentExecutionProgress = computed(() =>
  selectTaskExecutionProgress(
    executionProgress.state.value,
    props.selectedThread.map(({ id }) => id),
    props.currentTask.id,
  ),
)

watch(currentExecutionProgress, () => emit('onSizeChange'))

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

const taskCreatedAt = (task: TaskNode) => task.created_at ?? 0

const createTaskTreeMap = (extraTasks: readonly TaskNode[] = []) =>
  new Map([...props.selectedThread, ...extraTasks].map((task) => [task.id, task]))

const createTaskTreeNode = (task: TaskNode, children: taskTreeNodeType[] = []) => ({
  label: task.name || task.id.toString().slice(-5),
  taskid: task.id,
  task,
  ...(children.length > 0 ? { children } : {}),
  lazy: task.content.type === 'functioncall',
})

const findDirectChildTasks = (taskId: string, tasks: ReadonlyMap<string, TaskNode>) =>
  [...tasks.values()]
    .filter((task) => task.parentID === taskId && !task.priorID)
    .sort((a, b) => taskCreatedAt(a) - taskCreatedAt(b))

const findNextSiblingTask = (taskId: string, tasks: ReadonlyMap<string, TaskNode>) =>
  [...tasks.values()]
    .filter((task) => task.priorID === taskId)
    .sort((a, b) => taskCreatedAt(a) - taskCreatedAt(b))[0]

const buildSiblingQTree = (
  firstTask: TaskNode,
  tasks: ReadonlyMap<string, TaskNode>,
  includeChildren: boolean,
) => {
  const branch: taskTreeNodeType[] = []
  const visited = new Set<string>()
  let current: TaskNode | undefined = firstTask

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const children = includeChildren ? taskChainsToQTree(buildChildChains(current.id, tasks)) : []
    branch.push(createTaskTreeNode(current, children))
    current = findNextSiblingTask(current.id, tasks)
  }

  return branch
}

const buildChildChains = (taskId: string, tasks: ReadonlyMap<string, TaskNode>) =>
  findDirectChildTasks(taskId, tasks).map((child) => buildSiblingQTree(child, tasks, false))

const taskChainsToQTree = (taskChains: taskTreeNodeType[][]) => {
  if (taskChains.length > 1) {
    return taskChains.map((chain) => ({
      label: `SubChain ${chain[0]?.taskid.slice(0, 3)}`,
      taskid: `SubChain ${chain[0]?.taskid}`,
      children: chain,
      lazy: false,
    }))
  }
  return taskChains[0] ?? []
}

const getQTree = async (taskID: string, justChildren = false): Promise<taskTreeNodeType[]> => {
  const fetchedTask =
    taskById.value.get(taskID) ?? (await tystate.taskyonClient.task.get({ id: taskID }))
  if (!fetchedTask) return []
  const tasks = createTaskTreeMap([fetchedTask])

  if (justChildren) return taskChainsToQTree(buildChildChains(taskID, tasks))

  return buildSiblingQTree(fetchedTask, tasks, true)
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

.task-queue
  margin: 0.25rem 0

.task-queue-branch
  padding: 0 1rem 0.5rem

.task-queue-branch-button
  display: flex
  width: 100%
  align-items: center
  justify-content: space-between
  gap: 0.75rem
  padding: 0.25rem 0
  border: 0
  color: inherit
  background: transparent
  text-align: left
  cursor: pointer

.task-queue-branch-label
  overflow: hidden
  text-overflow: ellipsis
  white-space: nowrap

.task-queue-list
  margin: 0
  padding-left: 1.25rem
  font-size: 0.75rem
</style>
