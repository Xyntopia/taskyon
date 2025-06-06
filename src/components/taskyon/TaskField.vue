<template>
  <div class="task-container">
    <!--task meta data-->
    <div v-if="showMeta" class="text-overline text-right" style="font-size: 75%; line-height: 1.5">
      {{ task.id.slice(0, 5) }}
      {{ task.created_at ? new Date(task.created_at).toLocaleString() : '' }}
      <q-tooltip>{{ task.id }}</q-tooltip>
    </div>
    <div class="message-display">
      <!--Message Display-->
      <div class="row items-end">
        <!--task icon-->
        <div v-if="icon" class="col-auto self-center q-pr-sm">
          <q-icon :name="icon" :color="iconColor" size="sm" />
        </div>
        <!--task content-->
        <div class="col">
          <q-btn
            v-if="short"
            flat
            dense
            :icon-right="expandMessageContent ? matArrowDropUp : matArrowDropDown"
            no-caps
            @click="expandMessageContent = !expandMessageContent"
            style="width: 100%"
          >
            <!--task header-->
            <!--we need "col" here in roder to make sure, the div stretches..-->
            <div class="text-caption col">
              <slot name="header"></slot>
            </div>
          </q-btn>
          <q-slide-transition>
            <div v-show="!short || expandMessageContent">
              <!--expandable task content-->
              <slot></slot>
            </div>
          </q-slide-transition>
        </div>
        <!--task costs-->
        <div
          v-if="state.appConfiguration.showCosts && taskCostMeta"
          style="font-size: xx-small"
          class="col-auto column items-center task-costs"
        >
          <div v-if="taskCostMeta.taskCosts">
            {{ humanReadableTaskCosts }}
          </div>
          <q-icon
            :name="matMonetizationOn"
            size="xs"
            :color="
              taskCostMeta.taskCosts ? 'secondary' : taskCostMeta.promptTokens ? 'positive' : 'info'
            "
          ></q-icon>
          <div v-if="taskCostMeta.promptTokens">
            {{ taskCostMeta.promptTokens }}
          </div>
          <div v-else>
            {{
              (taskCostMeta.estimatedTokens?.promptTokens || 0) +
              (taskCostMeta.estimatedTokens?.resultTokens || 0)
            }}
          </div>
          <q-tooltip :delay="1000">
            <TokenUsage :task-meta="taskCostMeta" />
          </q-tooltip>
        </div>
      </div>
      <!--buttons-->
      <TaskButtons
        class="message-buttons"
        :task="task"
        @toggle-markdown="toggleMarkdown"
        @create-new-conversation="createNewConversation"
        @edit-task="editTask"
        @toggle-message-debug="toggleMessageDebug"
      />
    </div>
    <!--task debugging-->
    <q-slide-transition class="debug-container">
      <div v-show="state.messageDebug[task.id]">
        <TaskDebugTabs :task="task" />
      </div>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState'
import TokenUsage from 'components/taskyon/TokenUsage.vue'
import type { TaskNode } from 'src/modules/taskyon/types'
import { computed, ref } from 'vue'
import TaskButtons from './TaskButtons.vue'
import { matArrowDropDown, matArrowDropUp, matMonetizationOn } from '@quasar/extras/material-icons'
import { openrouterPricing } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import { useRouter } from 'vue-router'
import TaskDebugTabs from './TaskDebugTabs.vue'

const props = defineProps<{
  task: TaskNode
  icon?: string | undefined
  iconColor?: string | undefined
  short?: boolean | undefined
  showMeta: boolean | undefined
}>()

const { short = true, task } = props

const tystate = useTaskyonStore()

const expandMessageContent = ref<boolean>(false)
const router = useRouter()

const taskMeta = tystate.getTaskMetaRef(task.id)
const taskMetaNext = tystate.getTaskMetaRef(task.id)
const taskCostMeta = computed(() =>
  taskMeta.value?.estimatedTokens ? taskMeta.value : taskMetaNext?.value,
)

const state = useAppStateStore()

const humanReadableTaskCosts = computed(() => {
  if (taskCostMeta.value?.taskCosts) {
    return openrouterPricing(taskCostMeta.value.taskCosts)
  } else {
    return ''
  }
})

async function editTask(taskId: string) {
  const task = await (await tystate.getTaskManager()).getTask(taskId)
  if (task?.content?.type === 'tooldefinition') {
    void router.push(`/tool/${task.id}`)
  } else {
    tystate.setContentDraftFromTask(task)
    state.setSelectedTask(task?.priorID || task?.parentID)
  }
}

async function createNewConversation(taskId: string) {
  console.log('create new conversation...')
  const task = await (await tystate.getTaskManager()).getTask(taskId)
  tystate.setContentDraftFromTask(task)

  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.setSelectedTask(undefined)
}

function toggleMessageDebug(id: string) {
  if (state.messageDebug[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.messageDebug[id] = 'RAW'
  } else {
    // If it does exist, toggle the boolean.
    state.messageDebug[id] = undefined
  }
}

function toggleMarkdown(id: string) {
  if (state.taskState[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.taskState[id] = {
      markdownEnabled: true,
    }
  }
  // If it does exist, toggle the boolean.
  state.taskState[id].markdownEnabled = !state.taskState[id].markdownEnabled
  console.log(`markdown for ${id}`, state.taskState[id].markdownEnabled)
}
</script>
