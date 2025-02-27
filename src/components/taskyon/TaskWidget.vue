<template>
  <!--Task-->
  <div class="message-container">
    <div v-if="showId" class="text-overline text-right">
      {{ task.id }}<q-tooltip>Task ID</q-tooltip>
    </div>
    <div class="relative-position">
      <!--Message Display-->
      <div class="row items-end q-gutter-xs">
        <!--task icon-->
        <div v-if="task.content.type === 'error'" class="col-auto self-center">
          <q-icon :name="matWarning" color="negative" size="sm">
            <q-tooltip class="bg-warning">Error!</q-tooltip>
          </q-icon>
        </div>
        <div v-else-if="task.content.type === 'files'" class="col-auto self-center">
          <q-icon :name="mdiFileDocument" size="sm" color="info"></q-icon>
        </div>
        <div v-else-if="task.content.type === 'return'">
          <q-icon :name="matPause" size="sm" color="info"></q-icon>
        </div>
        <div v-else-if="task.role === 'system'" class="col-auto self-center">
          <q-icon :name="mdiDesktopTower" color="info" size="sm"></q-icon>
        </div>
        <!--task content-->
        <div v-if="task.content.type === 'functioncall'" class="col q-pb-md">
          <q-expansion-item
            dense
            :header-class="
              nextTask?.content.type === 'error'
                ? 'text-red'
                : nextTask?.content.type === 'toolresult'
                  ? 'text-green'
                  : 'text-info'
            "
          >
            <template #header>
              <div class="row q-gutter-sm items-center">
                <q-spinner-orbit v-if="isWorking" size="2em"></q-spinner-orbit>
                <q-icon :name="matCalculate" size="1.5em"></q-icon>
                <div>{{ task.content.data.name }}</div>
              </div>
            </template>
            <div>
              <ToolResultWidget
                :function-call="task.content.data"
                :result="
                  nextTask?.content.type === 'toolresult' ? nextTask.content.data : undefined
                "
              />
            </div>
          </q-expansion-item>
        </div>
        <div v-if="task.content.type === 'toolresult'" class="col q-pb-md">
          <ToolResultWidget
            :result="task.content.data"
            :function-call="
              previousTask?.content.type === 'functioncall' ? previousTask.content.data : undefined
            "
          />
        </div>
        <div v-else-if="task.content.type === 'structured'" class="col">
          <q-expansion-item dense :icon="mdiHeadCog" header-class="text-info" label="Analyze...">
            <p style="white-space: pre-wrap">
              {{ dump(task.content.data) }}
            </p>
          </q-expansion-item>
        </div>
        <div v-else-if="task.content.type === 'tooldefinition'">
          <q-expansion-item dense :icon="mdiTools" :label="`function: ${task.content.data.name}`">
            <p style="white-space: pre-wrap">
              {{ task.content.data }}
            </p>
          </q-expansion-item>
        </div>
        <div v-else-if="task.content.type === 'message'" class="col">
          <q-btn
            v-if="short"
            flat
            dense
            no-caps
            @click="expandMessageContent = !expandMessageContent"
          >
            <div class="text-caption">
              {{ task.content.data.split(' ').slice(0, 10).join(' ') }}...
            </div>
            <q-icon :name="expandMessageContent ? matArrowDropUp : matArrowDropDown" />
          </q-btn>
          <q-slide-transition>
            <div v-show="!short || expandMessageContent">
              <ty-markdown
                v-if="state.taskState[task.id]?.markdownEnabled != false"
                no-line-numbers
                style="min-width: 50px"
                :src="task.content.data"
              />
              <div v-else class="raw-markdown q-mb-md">
                {{ task.content.data }}
              </div>
            </div>
          </q-slide-transition>
        </div>
        <div v-else-if="task.content.type === 'files'" class="col">
          <FileBrowser
            v-if="getFile"
            :file-mappings="fileMappings"
            :expert-mode="state.appConfiguration.expertMode"
            preview
            :preview-size="100"
            :get-file="getFile"
          />
        </div>
        <div v-else-if="task.content.type === 'error'" class="col">
          <div>
            {{ task.content.data }}
          </div>
        </div>
        <div v-else-if="task.content.type === 'return'" class="col">
          <div>
            {{ task.content.data }}
          </div>
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
        :toggle-markdown="toggleMarkdown"
        :create-new-conversation="createNewConversation"
        :edit-task="editTask"
        :toggle-message-debug="toggleMessageDebug"
      />
    </div>
    <!--task debugging-->
    <q-slide-transition>
      <div v-show="state.messageDebug[task.id]">
        <q-separator spaced />
        <q-select
          v-if="false"
          class="fit q-pb-xs"
          dense
          disable
          label="Task Labels"
          filled
          :model-value="task.label || []"
          use-input
          use-chips
          multiple
          input-debounce="300"
          new-value-mode="add-unique"
          @update:model-value="updateLabels"
        >
          <template #prepend>
            <q-icon :name="matNewLabel" />
          </template>
        </q-select>
        <q-tabs v-model="state.messageDebug[task.id]" dense no-caps>
          <q-tab v-if="taskMeta?.error" name="ERROR" label="Error" />
          <q-tab name="TASKNODE" label="raw task data" />
          <q-tab v-if="taskMeta?.taskPrompt" name="TASKPROMPT" label="task prompt" />
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
import ToolResultWidget from 'src/components/taskyon/ToolResultWidget.vue'
import { useTaskyonStore } from 'stores/taskyonState'
import TokenUsage from 'components/taskyon/TokenUsage.vue'
import type { TaskNodeMeta } from 'src/modules/taskyon/types'
import { TaskNode, partialTaskDraft, type OpenAIMessage } from 'src/modules/taskyon/types'
import tyMarkdown from '../tyMarkdown.vue'
import { computed, ref } from 'vue'
import { type FileMappingDocType } from 'src/modules/taskyon/rxdb'
import { dump } from 'js-yaml'
import TaskButtons from './TaskButtons.vue'
import { mdiDesktopTower, mdiFileDocument, mdiHeadCog, mdiTools } from '@quasar/extras/mdi-v6'
import {
  matArrowDropDown,
  matArrowDropUp,
  matCalculate,
  matMonetizationOn,
  matNewLabel,
  matPause,
  matWarning,
} from '@quasar/extras/material-icons'
import { openrouterPricing } from 'src/modules/utils'
import FileBrowser from './FileBrowser.vue'
import { useAppStateStore } from 'src/stores/appState'
import type { TyTaskManager } from 'src/modules/taskyon/taskManager'
import { onUnmounted } from 'vue'

const props = defineProps<{
  task: TaskNode
  previousTask?: TaskNode | undefined
  nextTask?: TaskNode | undefined
  isWorking?: boolean
  short?: boolean
  showId?: boolean
}>()

const tystate = useTaskyonStore()

const initStr = undefined
const expandMessageContent = ref<boolean>(false)
const taskMeta = ref<TaskNodeMeta | undefined>(initStr)
const taskMetaPrevious = ref<TaskNodeMeta | undefined>(initStr)
const taskMetaNext = ref<TaskNodeMeta | undefined>(initStr)

const subscriptions: Array<() => void> = []
onUnmounted(() => subscriptions.forEach((unsub) => unsub()))

void tystate.getTaskManager().then((tm: TyTaskManager) => {
  ;[
    { id: props.task.id, ref: taskMeta },
    { id: props.previousTask?.id, ref: taskMetaPrevious },
    { id: props.nextTask?.id, ref: taskMetaNext },
  ].forEach(({ id, ref }) => {
    if (id) {
      subscriptions.push(
        tm.debugDb.readLive(id).subscribe(({ data }) => {
          ref.value = data || undefined
        }),
      )
    }
  })
})

const taskCostMeta = computed(() =>
  taskMeta.value?.estimatedTokens ? taskMeta.value : taskMetaNext?.value,
)

const state = useAppStateStore()
const fileMappings = ref<FileMappingDocType[]>([])
async function getFile(uuid: string) {
  console.log('load image', uuid)
  return (await tystate.getTaskManager()).getFile(uuid)
}

if (props.task.content.type === 'files') {
  console.log('get uploaded files')
  void (async (fileUuids: string[]) => {
    const tm = await tystate.getTaskManager()
    const fm = await Promise.all(fileUuids.map((uuid) => tm.getFileMappingByUuid(uuid)))
    fileMappings.value = fm.filter((x) => x != null)
    /*fileMappings.value = fm.map((x) => {
      const newfm = { ...x, xinfo: { uuid: x?.uuid } };
      return newfm;
    });*/
  })(props.task.content.data)
}

async function taskDraftFromTask(taskId: string) {
  // we are copying the current task with json stringify
  const jsonTask = JSON.stringify(await (await tystate.getTaskManager()).getTask(taskId))
  const task = TaskNode.partial().parse(JSON.parse(jsonTask))
  state.llmSettings.taskDraft = partialTaskDraft.parse(task)
  return task
}

const humanReadableTaskCosts = computed(() => {
  if (taskCostMeta.value?.taskCosts) {
    return openrouterPricing(taskCostMeta.value.taskCosts)
  } else {
    return ''
  }
})

async function editTask(taskId: string) {
  const task = await taskDraftFromTask(taskId)
  state.llmSettings.selectedTaskId = task.priorID
}

async function createNewConversation(taskId: string) {
  await taskDraftFromTask(taskId)

  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.llmSettings.selectedTaskId = undefined
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

// TODO: we'll get rid of this..  we only need
function updateLabels(labels: string[]) {
  console.log(labels)
  /*const tm = await tystate.getTaskManager()
  await tm.updateTask(
    {
      id: props.task.id,
      label: labels,
    },
    true,
  )*/
}
</script>

<style lang="sass" scoped>
.message-container
    .message-buttons
        position: absolute
        bottom: -2px  // To move up by 6px
        left: 20px   // To move left by 6px
        opacity: 0
        transition: opacity 0.3s

    &:hover
        .message-buttons
            opacity: 1

.raw-markdown
  white-space: pre-wrap // This will display newlines and wrap text
</style>
