<template>
  <div class="task-container">
    <!--task meta data-->
    <div v-if="showMeta" class="text-overline text-right" style="font-size: 75%; line-height: 1.5">
      {{ task.id.slice(0, 5) }}
      {{ task.created_at ? new Date(task.created_at).toLocaleString() : '' }}
      <q-tooltip>{{ task.id }}</q-tooltip>
    </div>
    <q-icon :name="matShield" class="task-safety-icon">
      <q-tooltip>This message is displayed in a secure sandbox</q-tooltip>
    </q-icon>
    <!--Message Display-->
    <div v-touch-hold="() => (showTaskMenu = true)" class="task-display">
      <div class="task-menu-anchor">
        <q-btn
          class="task-menu-btn"
          flat
          color="secondary"
          size="md"
          :icon="matMoreHoriz"
          @click.stop="showTaskMenu = !showTaskMenu"
        >
          <ResponsiveMenuDialog v-model="showTaskMenu" auto-close>
            <TaskMenu
              class="task-buttons"
              :task="task"
              @toggle-markdown="toggleMarkdown"
              @create-new-conversation="createNewConversation"
              @edit-task="editTask"
              @toggle-message-debug="toggleMessageDebug"
              @delete="deleteTask"
              @download="showDownloadDlg = true"
              @share="showShareDlg = true"
            />
          </ResponsiveMenuDialog>
        </q-btn>
      </div>
      <!--task-header-->
      <div class="task-header">
        <!--task icon-->
        <div v-if="icon" class="col-auto self-center q-pr-sm">
          <q-icon :name="icon" :color="iconColor" size="sm" />
        </div>
        <q-btn
          v-if="short"
          flat
          dense
          :icon-right="expandMessageContent ? matArrowDropUp : matArrowDropDown"
          no-caps
          style="width: 100%"
          @click="expandMessageContent = !expandMessageContent"
        >
          <!--task header-->
          <!--we need "col" here in roder to make sure, the div stretches..-->
          <div class="text-caption col">
            <slot name="header"></slot>
          </div>
        </q-btn>
      </div>
      <!--task content-->
      <q-slide-transition v-show="!short || expandMessageContent">
        <div>
          <!--expandable task content-->
          <slot></slot>
        </div>
      </q-slide-transition>
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
    <!--task debugging-->
    <q-slide-transition class="debug-container">
      <div v-show="state.messageDebug[task.id]">
        <TaskDebugTabs :task="task" />
      </div>
    </q-slide-transition>
    <share-dialog-btn v-model="showShareDlg" single share :task-or-id="task.id" />
    <share-dialog-btn v-model="showDownloadDlg" single download :task-or-id="task.id" />
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState'
import TokenUsage from 'components/taskyon/TokenUsage.vue'
import { computed, defineAsyncComponent, ref } from 'vue'
import TaskMenu from './TaskMenu.vue'
import {
  matArrowDropDown,
  matArrowDropUp,
  matMonetizationOn,
  matMoreHoriz,
  matShield,
} from '@quasar/extras/material-icons'
import { openrouterPricing } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import { useRouter } from 'vue-router'
import TaskDebugTabs from './TaskDebugTabs.vue'
import type { TaskNode } from '@taskyon/taskyon'
import ResponsiveMenuDialog from '../ResponsiveMenuDialog.vue'

const props = defineProps<{
  task: TaskNode
  icon?: string | undefined
  iconColor?: string | undefined
  short?: boolean | undefined
  showMeta: boolean | undefined
}>()

const ShareDialogBtn = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "ShareDialogButton" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      '../taskyon/TaskChainPublishDialog.vue'
    ),
)

const { short = true, task } = props

const tystate = useTaskyonStore()

const expandMessageContent = ref<boolean>(false)
const router = useRouter()

//const tmButton = useTemplateRef('tmButton')
const showTaskMenu = ref(false)
const showShareDlg = ref(false)
const showDownloadDlg = ref(false)
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

async function deleteTask(taskId: string) {
  const tm = await tystate.getTaskManager()
  const task = await tm.getTask(taskId)
  if (task) void tm.deleteTask(task.id)
  state.setSelectedTask(task?.priorID || task?.parentID)
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
  if (state.taskWidgetState[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.taskWidgetState[id] = {
      markdownEnabled: true,
    }
  }
  // If it does exist, toggle the boolean.
  state.taskWidgetState[id].markdownEnabled = !state.taskWidgetState[id].markdownEnabled
  console.log(`markdown for ${id}`, state.taskWidgetState[id].markdownEnabled)
}
</script>

<style scoped lang="sass">
.task-display
  position: relative
  display: flex
  flex-direction: column

  .task-menu-anchor
    position: sticky
    top: 20px                 // stick to the visible top edge of the task
    width: 100%
    pointer-events: none     // clicks pass through; button re-enables them
    z-index: 100 // needed so that we can press the button over the fade overlay!

  .task-menu-btn
    // Absolutely position the button relative to the sticky anchor
    position: absolute
    right: 0px
    top: 0px  // visual offset INSIDE the task; tweak as needed
    pointer-events: auto

    // hover/focus reveal
    opacity: 0
    transition: opacity 0.2s ease
    filter: drop-shadow(0 2px 6px rgba(0,0,0,.25))

  // Reveal on hover/focus of card or button
  &:hover .task-menu-btn,
  .task-menu-btn:hover,
  .task-menu-btn:focus,
  .task-menu-btn:focus-within
    opacity: 1
</style>
