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
    <!--Task Display-->
    <div v-touch-hold="() => (showTaskMenu = true)" class="task-display">
      <!-- Context menu - positioned at right-click location -->
      <ResponsiveMenuDialog v-if="!textSelected" v-model="showTaskMenu" auto-close context-menu>
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

      <!--task-header-->
      <div v-if="short" class="row col task-header">
        <!--task icon-->
        <div v-if="icon" class="col-auto self-center q-pr-sm">
          <q-icon :name="icon" :color="iconColor" size="sm" />
        </div>
        <q-btn
          flat
          dense
          :icon-right="expandMessageContent ? matArrowDropUp : matArrowDropDown"
          no-caps
          style="width: 100%"
          class="col"
          @click="expandMessageContent = !expandMessageContent"
        >
          <!--task header-->
          <!--we need "col" here in roder to make sure, the div stretches..-->
          <div class="text-caption col">
            <slot name="header"></slot>
          </div>
        </q-btn>
        <q-btn
          v-if="!expandMessageContent"
          class="task-menu-btn"
          flat
          color="secondary"
          size="md"
          dense
          :icon="matMoreHoriz"
        >
          <q-menu ref="taskMenuRef" auto-close>
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
          </q-menu>
        </q-btn>
      </div>

      <!--Context Menu Button-->
      <div v-if="!short || expandMessageContent" class="task-menu-anchor">
        <q-btn
          v-if="!$q.platform.is.mobile"
          class="task-menu-btn"
          flat
          color="secondary"
          size="md"
          dense
          :icon="matMoreHoriz"
        >
          <q-menu ref="taskMenuRef" auto-close>
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
          </q-menu>
        </q-btn>
      </div>

      <!--task content-->
      <q-slide-transition v-show="!short || expandMessageContent">
        <div>
          <!--expandable task content-->
          <slot
            :show-task-menu="
              (state: boolean) => {
                showTaskMenu = state
                if (!state) {
                  taskMenu?.hide()
                }
              }
            "
          ></slot>
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
      <div v-show="messageDebug">
        <TaskDebugTabs :task="task" />
      </div>
    </q-slide-transition>
    <template v-if="task.id">
      <share-dialog-btn v-model="showShareDlg" single share :task-or-id="task.id" />
      <share-dialog-btn v-model="showDownloadDlg" single download :task-or-id="task.id" />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  matArrowDropDown,
  matArrowDropUp,
  matMonetizationOn,
  matMoreHoriz,
  matShield,
} from '@quasar/extras/material-icons'
import ResponsiveMenuDialog from '@taskyon/shared/components/ResponsiveMenuDialog.vue'
import type { TaskNode } from '@taskyon/taskyon'
import { useTextSelection } from '@vueuse/core'
import TokenUsage from 'components/taskyon/TokenUsage.vue'
import { type QMenu } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { openrouterPricing } from '../../../packages/shared/modules/utils'
import TaskDebugTabs from './TaskDebugTabs.vue'
import TaskMenu from './TaskMenu.vue'

const props = defineProps<{
  task: TaskNode
  icon?: string | undefined
  iconColor?: string | undefined
  short?: boolean | undefined
  showMeta: boolean | undefined
  messageDebug: boolean
}>()
const emit = defineEmits<{
  (e: 'update:messageDebug', value: boolean): void
}>()

const taskMenu = useTemplateRef<QMenu>('taskMenuRef')
const textSelectionState = useTextSelection()
const textSelected = computed(() => textSelectionState.text.value.length > 0)

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
const messageDebug = computed(() => props.messageDebug)

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
  const task = await (await tystate.taskyon).getTask(taskId)
  if (task?.content?.type === 'tooldefinition') {
    void router.push(`/tool/${task.id}`)
  } else {
    tystate.setContentDraftFromTask(task)
    state.setSelectedTask(task?.priorID || task?.parentID)
  }
}

async function deleteTask(taskId: string) {
  const ty = await tystate.taskyon
  const task = await ty.getTask(taskId)
  if (task) void ty.deleteTask(task.id)
  state.setSelectedTask(task?.priorID || task?.parentID)
}

async function createNewConversation(taskId: string) {
  console.log('create new conversation...')
  const task = await (await tystate.taskyon).getTask(taskId)
  tystate.setContentDraftFromTask(task)

  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.setSelectedTask(undefined)
}

function toggleMessageDebug(id: string) {
  if (id !== task.id) return
  emit('update:messageDebug', !props.messageDebug)
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

<style lang="sass">
.task-display
  display: inline-flex
  flex-direction: column
  align-items: auto

  .task-header
    display: flex
    flex-flow: row nowrap
    align-items: flex-start

.task-display
  position: relative
  display: flex
  flex-direction: column

  .task-menu-anchor
    position: sticky
    top: 10px
    width: 100%
    pointer-events: none
    z-index: 100

    .task-menu-btn
      // Positioning
      position: absolute
      right: 0
      top: 5px
      pointer-events: auto


  .task-menu-btn
    // Shape/visibility
    opacity: .3
    transform: translateY(-3px) scale(.94)
    transition: opacity .2s ease, transform .2s cubic-bezier(.17,.89,.32,1.27), box-shadow .2s ease, filter .2s ease, background-color .2s ease

    // Baseline ring + soft shadow (uses currentColor from Quasar's 'color' prop)
    //box-shadow: 0px 0px 2px rgba($secondary,1.0)

    // Slight glassy plate so it reads on busy backgrounds
    // backdrop-filter: blur(6px)
    // background-color: rgba($secondary,0.8)

    &:focus-visible
      outline: none


  // Reveal on hover/focus with a pop
  &:hover .task-menu-btn,
  .task-menu-btn:hover,
  .task-menu-btn:focus,
  .task-menu-btn:focus-within
    opacity: 1
    transform: translateY(0) scale(1)
    background-color: rgba(white,.8)
    //box-shadow: 0px 0px 5px rgba($secondary,1.0)
    animation: pop-in 160ms cubic-bezier(.17,.89,.32,1.27)

.body--dark
  .task-display
    &:hover .task-menu-btn,
    .task-menu-btn:hover,
    .task-menu-btn:focus,
    .task-menu-btn:focus-within
      background-color: rgba($dark,.8)

@keyframes pop-in
  0%
    transform: translateY(6px) scale(.88)
    opacity: 0
  60%
    transform: translateY(-1px) scale(1.06)
    opacity: 1
  100%
    transform: translateY(0) scale(1)

@media (prefers-reduced-motion: reduce)
  .task-menu-btn
    transition: opacity .2s ease
    transform: none
  .task-display:hover .task-menu-btn,
  .task-menu-btn:hover,
  .task-menu-btn:focus,
  .task-menu-btn:focus-within
    animation: none
    transform: none
</style>
