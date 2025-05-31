<template>
  <div>
    <!--task header-->
    <div v-if="showMeta" class="text-overline text-right" style="font-size: 75%; line-height: 1.5">
      {{ task.id.slice(0, 5) }}
      {{ task.created_at ? new Date(task.created_at).toLocaleString() : '' }}
      <q-tooltip>{{ task.id }}</q-tooltip>
    </div>
    <!--task content-->
    <div class="relative-position">
      <!--Message Display-->
      <div class="row items-end q-gutter-xs">
        <!--task icon-->
        <div v-if="icon" class="col-auto self-center">
          <q-icon :name="icon" :color="iconColor" size="sm" />
        </div>
        <!--task content-->
        <div class="col q-pb-md">
          <q-btn
            v-if="short"
            flat
            dense
            no-caps
            @click="expandMessageContent = !expandMessageContent"
          >
            <div class="text-caption">
              <slot name="header"></slot>
            </div>
            <q-icon :name="expandMessageContent ? matArrowDropUp : matArrowDropDown" />
          </q-btn>
          <q-slide-transition>
            <div v-show="!short || expandMessageContent">
              <slot></slot>
            </div>
          </q-slide-transition>
        </div>
        <!--task costs-->
        <div
          v-if="state.appConfiguration.showCosts && taskCostMeta"
          style="font-size: xx-small"
          class="col-auto column items-center print-hide task-costs"
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
        class="message-buttons absolute-bottom-left print-hide rounded-borders"
        :task="task"
        @toggle-markdown="toggleMarkdown"
        @create-new-conversation="createNewConversation"
        @edit-task="editTask"
        @toggle-message-debug="toggleMessageDebug"
      />
    </div>
    <!--task debugging-->
    <q-slide-transition>
      <div v-show="state.messageDebug[task.id]">
        <q-separator spaced />
        <q-tabs v-model="state.messageDebug[task.id]" dense no-caps>
          <q-tab v-if="taskMeta?.error" name="ERROR" label="Error" />
          <q-tab name="TASKNODE" label="raw task data" />
          <q-tab v-if="taskMeta?.taskPrompt" name="TASKPROMPT" label="raw conversation" />
          <q-tab v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT" label="raw input" />
          <q-tab name="DEBUGGING" label="debugging" />
        </q-tabs>
        <q-tab-panels
          v-model="state.messageDebug[task.id]"
          animated
          swipeable
          horizontal
          transition-prev="jump-right"
          transition-next="jump-left"
        >
          <q-tab-panel name="ERROR">
            <textarea
              :value="JSON.stringify(taskMeta?.error, null, 2)"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="TASKNODE">
            <textarea
              :value="JSON.stringify(task, null, 2)"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel v-if="taskMetaPrevious?.rawOutput" name="RAW_INPUT">
            <textarea
              :value="JSON.stringify(taskMetaPrevious.rawOutput, null, 2)"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel v-if="taskMeta?.taskPrompt" name="TASKPROMPT">
            <textarea
              v-for="(tp, idx) in taskMeta.taskPrompt.openAIConversationThread as OpenAIMessage[]"
              :key="idx"
              :value="typeof tp.content === 'string' ? tp.content : ''"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
            <div class="text-caption">finished completion:</div>
            <textarea
              :value="taskChoice || null"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
          </q-tab-panel>
          <q-tab-panel name="DEBUGGING">
            <textarea
              :value="JSON.stringify(taskMeta, null, 2)"
              readonly
              wrap="soft"
              style="width: 100%; height: 200px; background-color: inherit; color: inherit"
            >
            </textarea>
          </q-tab-panel>
        </q-tab-panels>
      </div>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState'
import TokenUsage from 'components/taskyon/TokenUsage.vue'
import type { ChatResponseType, TaskNodeMeta, TaskNode } from 'src/modules/taskyon/types'
import { type OpenAIMessage } from 'src/modules/taskyon/types'
import { computed, ref } from 'vue'
import TaskButtons from './TaskButtons.vue'
import { matArrowDropDown, matArrowDropUp, matMonetizationOn } from '@quasar/extras/material-icons'
import { openrouterPricing } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import type { TyTaskManager } from 'src/modules/taskyon/taskManager'
import { onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{
  task: TaskNode
  icon?: string | undefined
  iconColor?: string | undefined
  short?: boolean | undefined
  showMeta: boolean | undefined
}>()

const { short = true, task } = props

const tystate = useTaskyonStore()

const initStr = undefined
const expandMessageContent = ref<boolean>(false)
const taskMetaPrevious = ref<TaskNodeMeta | undefined>(initStr)
const taskMetaNext = ref<TaskNodeMeta | undefined>(initStr)
const router = useRouter()

const subscriptions: Array<() => void> = []
onUnmounted(() => subscriptions.forEach((unsub) => unsub()))

async function getTaskMeta(taskId: string) {
  const taskMetaRef = ref<TaskNodeMeta>()
  const tm = await tystate.getTaskManager()
  subscriptions.push(
    tm.debugDb.readLive(taskId).subscribe(({ data }) => {
      taskMetaRef.value = data || undefined
    }),
  )
  return computed(() => taskMetaRef)
}

const taskMeta = getTaskMeta(task.id)
const taskCostMeta = computed(() =>
  taskMeta.value?.estimatedTokens ? taskMeta.value : taskMetaNext?.value,
)

const taskChoice = computed(() => {
  try {
    return (taskMeta.value?.rawOutput as { choice: ChatResponseType['choices'][0] }).choice?.message
      .content
  } catch {
    return '<no chatcompletion output avaailable>'
  }
})

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
