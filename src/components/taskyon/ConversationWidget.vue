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
            <div class="col">
              <div v-if="prop.node.task" class="text-caption">
                {{ prop.node.taskid.slice(0, 5) }}
                {{ new Date(prop.node.task.created_at).toLocaleString() }}
                <q-tooltip>{{ prop.node.taskid }}</q-tooltip>
              </div>
              <div v-else class="text-bold">{{ prop.node.taskid.slice(0, 12) }}</div>
              <q-card
                v-if="prop.node.task"
                class="task-container"
                :flat="$q.dark.isActive"
                :class="[prop.node.task.role, Object.keys(prop.node.task.content)[0]]"
                @click.stop
              >
                <Task
                  :id="prop.node.task.id"
                  :task="prop.node.task"
                  short
                  :class="[
                    'q-pa-xs',
                    prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
                  ]"
                  :show-id="!!showIds"
                />
              </q-card>
            </div>
          </template>
        </q-tree>
      </div>
      <div v-else-if="showHierarchy" class="tasks-container q-pa-sm q-pl-md">
        <q-tree dense node-key="taskid" :nodes="taskHierarchy" default-expand-all>
          <template #default-header="prop">
            <q-card
              class="task-container"
              :flat="$q.dark.isActive"
              :class="[prop.node.task.role, Object.keys(prop.node.task.content)[0]]"
              @click.stop
            >
              <Task
                :id="prop.node.task.id"
                :task="prop.node.task"
                short
                :class="[
                  'q-pa-xs',
                  prop.node.task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
                ]"
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
            :class="`task-container row ${task.role === 'user' ? 'justify-end' : ''}`"
          >
            <q-card :flat="$q.dark.isActive" :class="[task.role, Object.keys(task.content)[0]]">
              <Task
                :id="task.id"
                :task="task"
                :previous-task="props.selectedThread[idx - 1]"
                :next-task="props.selectedThread[idx + 1]"
                :is-working="
                  !!tystate.lastTaskState.get(task.id) &&
                  tystate.lastTaskState.get(task.id) !== 'processed'
                "
                :class="['q-pa-xs', task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
                :show-id="!!showIds"
                style="min-width: 300px"
              />
            </q-card>
          </div>
        </template>
      </div>
      <!--Render tasks which are in progress-->
      <div class="tasks-container q-py-sm">
        <q-card
          v-if="
            !!tystate.lastTaskState.get(currentTask.id) &&
            tystate.lastTaskState.get(currentTask.id) !== 'processed'
          "
          class="row"
        >
          <div class="col">
            <ty-markdown
              v-if="currentStream"
              no-line-numbers
              no-mermaid
              :use-iframe="false"
              :src="currentStream || ''"
            />
            <div v-else>
              {{ tystate.lastTaskState.get(currentTask.id) }}
            </div>
            <q-spinner-dots size="2rem" color="secondary" />
          </div>
        </q-card>
        <div
          v-else-if="taskWorkerMessage"
          class="transparent text-negative text-bold q-pa-md task-container"
        >
          {{ taskWorkerMessage }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TaskNode } from 'src/modules/taskyon/types'
import Task from 'components/taskyon/TaskWidget.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import { useQuasar } from 'quasar'
import { asyncComputed } from 'src/stores/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount } from 'vue'
import { ref } from 'vue'
import { type TaskTreeNode } from 'src/modules/taskyon/taskManager'
const $q = useQuasar()

const tystate = useTaskyonStore()

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask?: TaskNode | undefined | null
  taskWorkerWaiting: boolean
  taskWorkerMessage?: string
  showAllTasks?: boolean
  showHierarchy?: boolean
  taskTreeRoot?: string | undefined
  showIds?: boolean
  expertMode?: boolean
}>()

const streamingContentTracker = ref<Map<string, string>>(new Map<string, string>())

const streamCallback: Parameters<typeof tystate.streamCallBacks.addGlobal>[0] = ({
  taskId,
  chunk,
}) => {
  //console.log('received stream for', taskId)
  if (chunk?.choices[0]?.delta?.tool_calls) {
    chunk?.choices[0]?.delta?.tool_calls.forEach((t) => {
      // TODO: add streaming for function calls
      console.log(t)
    })
  }
  if (chunk?.choices[0]?.delta?.content) {
    streamingContentTracker.value.set(
      taskId,
      (streamingContentTracker.value.get(taskId) ?? '') + chunk.choices[0].delta.content,
    )
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

tystate.streamCallBacks.addGlobal(streamCallback)

onBeforeUnmount(() => {
  tystate.streamCallBacks.removeGlobal(streamCallback)
})

const currentStream = computed(() => {
  if (props.currentTask) return streamingContentTracker.value.get(props.currentTask.id)
  else return undefined
})

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
