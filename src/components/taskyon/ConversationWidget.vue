<template>
  <div class="col" style="background-color: inherit; color: inherit" flat square>
    <div v-if="currentTask" class="q-px-xs">
      <div v-if="showTaskTree" class="tasks-container q-pa-sm q-pl-md">
        <!--<pre>{{ JSON.stringify(taskTree, undefined, 2) }}</pre>-->
        <q-tree
          dense
          node-key="taskid"
          :nodes="taskTree"
          default-expand-all
          @lazy-load="onLazyLoad"
        >
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
                style="min-width: 300px"
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
      <div v-else class="q-gutter-xs tasks-container">
        <template v-for="(task, idx) in props.selectedThread" :key="task.id">
          <q-card
            v-if="showAllTasks || showTask(task)"
            class="task-container"
            :flat="$q.dark.isActive"
            :class="[task.role, Object.keys(task.content)[0]]"
          >
            <Task
              :id="task.id"
              :task="task"
              :previous-task="props.selectedThread[idx - 1]"
              :next-task="props.selectedThread[idx + 1]"
              :is-working="!taskWorkerWaiting && task.id === currentTask.id"
              style="min-width: 300px"
              :class="['q-pa-xs', task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '']"
              :show-id="!!showIds"
            />
          </q-card>
        </template>
      </div>
      <!--Render tasks which are in progress-->
      <div class="tasks-container">
        <q-card v-if="!taskWorkerWaiting" class="row">
          <div class="col">
            <ty-markdown no-line-numbers no-mermaid :src="currentStream || ''" />
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
    </div>
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
const $q = useQuasar()

const tystate = useTaskyonStore()

const props = defineProps<{
  selectedThread: TaskNode[]
  currentTask?: TaskNode | undefined | null
  taskWorkerWaiting: boolean
  taskWorkerMessage?: string
  showAllTasks?: boolean
  showTaskTree?: boolean
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
  taskid: string
  task: TaskNode
  children?: taskTreeNodeType[]
  lazy?: boolean
}

const taskTree = computed(() => {
  let taskTree = [] as taskTreeNodeType[]
  let nextDirectChildren = [] as taskTreeNodeType[]

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

  return taskTree
})

async function onLazyLoad({
  /*node,*/
  key,
  done,
  /*fail,*/
}: {
  node: unknown
  done: (children?: readonly any[]) => void
  key: string
  fail: unknown
}) {
  // call fail() if any error occurs
  const tm = await tystate.getTaskManager()

  const childrenChains = await tm.buildTaskTreeNode(key, 1)

  const children = childrenChains.children.map((ttn) => ({
    label: ttn.task.name || ttn.task.id.toString().slice(-5),
    taskid: ttn.task.id,
    task: ttn.task,
  }))
  done(children)
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
