<template>
  <!--Create new task area-->
  <div class="create-new-task">
    <!--Task Creation-->
    <div>
      <div>
        <taskContentEdit
          v-if="
            !selectedTaskType &&
            !codingMode &&
            state.llmSettings.taskDraft.content.type === 'message'
          "
          class="text-body1"
          :model-value="state.llmSettings.taskDraft.content.data"
          :execute-task="addNewTask"
          :attach-file-to-chat="attachFileToDraft"
          :use-enter-to-send="state.appConfiguration.useEnterToSend"
          @update:model-value="updateContent"
        />
        <div
          v-else-if="
            !selectedTaskType &&
            codingMode &&
            state.llmSettings.taskDraft.content.type === 'message'
          "
        >
          <CodeEditor
            :model-value="state.llmSettings.taskDraft.content.data"
            @update:model-value="updateContent"
          />
          <taskSettingsButton v-model="expandedTaskCreation" aria-label="task settings" />
          <q-btn
            :disable="!sendAllowed"
            :color="sendAllowed ? 'positive' : 'negative'"
            :icon="matSave"
            label="save task"
            @click="addNewTask(false)"
            ><q-tooltip>Save task without executing it...</q-tooltip></q-btn
          >
        </div>
        <div
          v-else-if="
            selectedTaskType && state.llmSettings.taskDraft.content.type === 'functioncall'
          "
          class="row"
        >
          <ObjectTreeView
            v-model="state.llmSettings.taskDraft.content.data.arguments"
            class="col"
            input-field-behavior="auto"
            :separate-labels="false"
          />
        </div>
      </div>
      <!--Task Creation State-->
      <div v-if="!hideTaskInfo" class="q-px-sm q-pt-xs text-caption">
        <div class="row items-center">
          <div class="row">
            <ToggleButton
              dense
              :size="functionToggleBtnSize"
              outline
              :icon="mdiTools"
              v-model="state.llmSettings.enableToolChooser"
            >
              <div class="q-pl-sm gt-xs">Use Tools</div>
              <q-tooltip :delay="200">
                {{ llmSettings.shape.enableToolChooser.description }}
              </q-tooltip>
            </ToggleButton>
            <ToggleButton
              v-if="expertMode"
              v-model="state.llmSettings.useBasePrompt"
              outline
              :size="functionToggleBtnSize"
              dense
              :on-icon="mdiAutoFix"
              :off-icon="mdiAlphabeticalVariant"
            >
              <div class="q-pl-sm gt-xs">Fancy AI</div>
              <q-tooltip :delay="200">
                {{ llmSettings.shape.useBasePrompt.description }}
              </q-tooltip>
            </ToggleButton>
            <ToggleButton
              v-if="expertMode"
              v-model="state.llmSettings.tryUsingVisionModels"
              outline
              :size="functionToggleBtnSize"
              dense
              :on-icon="matVisibility"
              :off-icon="matVisibilityOff"
            >
              <div class="q-pl-sm gt-xs">Vision</div>
              <q-tooltip :delay="200">
                {{ llmSettings.shape.tryUsingVisionModels.description }}
              </q-tooltip>
            </ToggleButton>
            <ToggleButton
              v-if="expertMode"
              v-model="state.llmSettings.enableOpenAiTools"
              on-icon="svguse:/taskyon_mono_opt.svg#taskyon"
              :off-icon="matSmartToy"
              :size="functionToggleBtnSize"
              dense
              outline
              reverse
            >
              <q-icon :name="mdiFunctionVariant"></q-icon>
              <q-tooltip :dely="200">
                If turned on, use taskyon function selection mode for models which support this.
                Otherwise use the built-in support for models which support this. Taskyon mode is
                usually recommended as it is model agnostic.</q-tooltip
              ></ToggleButton
            >
          </div>
          <div class="row q-px-md">
            <info-dialog
              v-if="currentModel && tystate.modelLookUp[currentModel]?.description"
              size="xs"
              :info-text="tystate.modelLookUp[currentModel]?.description || ''"
            />
            <q-btn flat dense size="sm" no-caps>
              <q-icon :name="matSmartToy" class="q-px-xs" />
              <div class="ellipsis gt-sm">
                {{ `${currentModel}` }}
              </div>
              <div class="text-weight-thin gt-sm">/{{ currentChatApi }}</div>
              <q-tooltip>Select AI model (current model: {{ currentModel }})</q-tooltip>
              <q-menu color="secondary">
                <q-list style="min-width: 100px">
                  <q-item-label header>Select previous AI model!</q-item-label>
                  <q-item v-if="state.modelHistory.length === 0" v-close-popup>
                    No other models were selected yet!
                  </q-item>
                  <q-item
                    v-for="(m, idx) in state.modelHistory"
                    :key="m"
                    v-close-popup
                    clickable
                    @click="handleBotNameUpdate({ newName: m })"
                  >
                    <q-item-section>{{ state.modelHistory.length - idx }}: {{ m }}</q-item-section>
                  </q-item>
                  <q-item
                    v-close-popup
                    clickable
                    @click="expandedTaskCreation = !expandedTaskCreation"
                  >
                    <q-item-section avatar>
                      <q-icon :name="matSmartToy"></q-icon>
                    </q-item-section>
                    <q-item-section> More AI Settings </q-item-section>
                    <q-item-section side>
                      <q-icon :name="matNavigateNext"></q-icon>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
          <q-space></q-space>
          <template v-if="currentModel && expertMode && false">
            <div class="gt-xs">
              {{ `t/c: ${estimatedTokens}/${tystate.modelLookUp[currentModel]?.context_length}` }}
              <q-tooltip :delay="1000" class="q-gutter-sm">
                <div>
                  [approximate number of tokens in prompt] / [max number of tokens which AI can
                  understand]
                </div>
                <div>Tokens are roughly similar to syllables.</div>
              </q-tooltip>
            </div>
            <div class="lt-sm">{{ `t/c: ${estimatedTokens}` }}</div>
          </template>
          <q-space></q-space>
          <div>
            <q-btn
              flat
              size="sm"
              aria-label="toggle task settings"
              @click="expandedTaskCreation = !expandedTaskCreation"
            >
              <q-icon size="xs" :name="matTune" class="q-pl-sm"></q-icon>
              <q-icon
                size="xs"
                :name="expandedTaskCreation ? matKeyboardArrowUp : matKeyboardArrowDown"
              ></q-icon>
              <q-tooltip>Chat Settings</q-tooltip>
            </q-btn>
          </div>
        </div>
        <div v-if="fileAttachments.length">
          <div>Attached files:</div>
          <q-chip
            v-for="file in fileAttachments"
            :key="file.name"
            removable
            :icon="matUploadFile"
            @remove="fileAttachments = fileAttachments.filter((f) => f !== file)"
          >
            <div class="ellipsis" style="max-width: 100px">
              {{ `${file.name}` }}
            </div>
            <q-tooltip :delay="0.5">{{ `${file.name}` }}</q-tooltip>
          </q-chip>
        </div>
      </div>
      <!--Task type selection and execution-->
      <div v-if="selectedTaskType || expandedTaskCreation" class="row items-center">
        <q-btn v-if="selectedTaskType" class="q-ma-md" label="Execute Task" @click="addNewTask()" />
        <q-btn v-if="selectedTaskType" flat dense :icon="matChat" @click="setTaskType(undefined)"
          ><q-tooltip>Select Simple Chat</q-tooltip>
        </q-btn>
        <q-select
          v-if="expertMode"
          style="min-width: 200px"
          class="q-pt-xs q-px-md"
          dense
          outlined
          color="secondary"
          clearable
          :bg-color="selectedTaskType ? 'secondary' : ''"
          :model-value="selectedTaskType"
          :options="Object.keys(toolCollection)"
          :label="selectedTaskType ? 'selected Tool' : 'Select Tool'"
          @update:model-value="setTaskType"
        />
      </div>
    </div>
    <q-slide-transition>
      <q-list v-show="expandedTaskCreation" dense>
        <q-separator class="q-my-sm" />
        <!--Model Selection-->
        <q-item class="row items-center">
          <q-icon :name="matSmartToy" size="sm" class="q-pr-md"></q-icon>
          <ModelSelection
            v-model:selected-api="selectedApi"
            class="col"
            :bot-name="currentModel"
            :model-list="expertMode"
            :select-api="expertMode"
            @update-bot-name="handleBotNameUpdate"
          ></ModelSelection>
        </q-item>
      </q-list>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, toRefs } from 'vue'
import { createToolTask, getDefaultParametersForTool } from 'src/modules/taskyon/tools'
import { partialTaskDraft } from 'src/modules/taskyon/types'
import { getApiConfig, llmSettings, getCurrentModel } from 'src/modules/taskyon/types'
import '@quasar/quasar-ui-qmarkdown/dist/index.css'
import { useTaskyonStore } from 'stores/taskyonState'
import type { FunctionArguments, ToolBase } from 'src/modules/taskyon/types'
import ModelSelection from 'components/taskyon/ModelSelection.vue'
import { saveUserUploadedFileToOpfs } from 'src/modules/OPFS'
import ObjectTreeView from '../ObjectTreeView.vue'
import taskSettingsButton from './taskSettingsButton.vue'
import taskContentEdit from './taskContentEdit.vue'
//import CodeEditor from './CodeEditor.vue';
import { defineAsyncComponent } from 'vue'
import { watchDebounced } from '@vueuse/core'
import InfoDialog from '../InfoDialog.vue'
import ToggleButton from '../ToggleButton.vue'
import {
  matSave,
  matUploadFile,
  matChat,
  matSmartToy,
  matNavigateNext,
  matKeyboardArrowUp,
  matKeyboardArrowDown,
  matTune,
  matVisibility,
  matVisibilityOff,
} from '@quasar/extras/material-icons'
import {
  mdiAlphabeticalVariant,
  mdiAutoFix,
  mdiTools,
  mdiFunctionVariant,
} from '@quasar/extras/mdi-v6'
import { deepCopy, deepMerge } from 'src/modules/utils'
import { useNlpWorker } from 'src/modules/taskyon/webWorkerApi'
import { useAppStateStore } from 'src/stores/appState'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'
import type OpenAI from 'openai'

const functionToggleBtnSize = 'md'

const CodeEditor = defineAsyncComponent(
  () =>
    import(
      /* webpackPrefetch: true */
      /* webpackChunkName: "codemirror" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      '../CodeEditor.vue'
    ),
)

const props = defineProps<{
  codingMode?: boolean
  forceTaskProps?: llmSettings['taskTemplate'] | undefined
  sendAllowed?: boolean
  hideTaskInfo?: boolean
}>()

function updateContent(value: string | null | undefined) {
  state.llmSettings.taskDraft.content = {
    type: 'message',
    data: value || '',
  }
}

const state = useAppStateStore()
const tystate = useTaskyonStore()
const { expandedTaskCreation } = toRefs(state)
const { expertMode } = toRefs(state.appConfiguration)
const { selectedApi } = toRefs(state.llmSettings)
const fileAttachments = ref<File[]>([]) // holds all attached files as a "tasklist"

// we initialize our taskDraft with the state of this window!

//const funcArgs = computed(() => );

async function getAllTools() {
  const foundTools = await (await tystate.getTaskManager()).updateToolDefinitions(true)
  return foundTools
}

const toolCollection = ref<Record<string, ToolBase>>({})
void getAllTools().then((tools) => (toolCollection.value = tools))

// Computed property to determine the currently selected bot name
// TODO: we can move this into taskyonstate?// TODO: we can move this into taskyonstate?
const currentModel = computed(() => {
  return getCurrentModel(state.llmSettings)
})

const currentChatApi = ref<string>(toRaw(state.llmSettings.selectedApi) || '')

// Method to handle the updateBotName event
const handleBotNameUpdate = ({ newName, newService }: { newName: string; newService?: string }) => {
  console.log('getting an api & bot update :)', newName, newService)
  if (newService) {
    currentChatApi.value = newService
    state.llmSettings.selectedApi = newService
  }
  const api = getApiConfig(state.llmSettings)
  if (api) {
    api.selectedModel = newName
  }
  tystate.addModelToHistory(newName)
}

const selectedTaskType = computed(() => {
  const task = state.llmSettings.taskDraft
  return task.content.type === 'functioncall' ? task.content.data.name : undefined
})

async function setTaskType(tasktype: string | undefined | null) {
  console.log('change tasktype to:', tasktype)
  if (tasktype) {
    state.llmSettings.taskDraft.role = 'function'
    const toolName = tasktype
    const tool = (await getAllTools())[tasktype]
    if (!tool) {
      console.log(`Tool ${toolName} not found.`)
      return null
    }
    const defaultParams = getDefaultParametersForTool(tool)
    const savedParams = state.draftParameters[tasktype]
    const funcArguments: FunctionArguments = {
      ...(defaultParams || {}),
      ...(savedParams || {}),
    }
    state.llmSettings.taskDraft.content = {
      type: 'functioncall',
      data: {
        name: tasktype,
        arguments: funcArguments,
      },
    }
  } else {
    state.llmSettings.taskDraft.role = 'user'
    state.llmSettings.taskDraft.content = {
      type: 'message',
      data: '',
    }
  }
}

const currentnewTask = computed(() => {
  const task = deepMerge(state.llmSettings.taskDraft, props.forceTaskProps || {})
  if (currentModel.value) {
    task.name = undefined
    if (selectedTaskType.value && state.llmSettings.taskDraft.content.type === 'functioncall') {
      // here we have a function task ;)
      task.role = 'function'
      // we do this to make suere we *only* have a functionCall and not a message
      // or other things as well...
      task.content = {
        type: 'functioncall',
        data: state.llmSettings.taskDraft.content.data,
      }
    } else if (state.llmSettings.taskDraft.content.type === 'message') {
      task.role = 'user'
      task.content = {
        type: 'message',
        data: state.llmSettings.taskDraft.content.data.trim(),
      }
    }
  }
  return partialTaskDraft.parse(task) // we can do this, because we defined the "role"
})

const { estimateChatTokens } = useNlpWorker()

// TODO:   our token estimation needs to become much better ^^
// TODO:   e.g. add prompts to our task :)
const estimatedTokens = ref<number>(0)
watchDebounced(
  [() => state.llmSettings.taskDraft.content, () => state.llmSettings.selectedTaskId],
  async () => {
    console.log('calculate tokens...')
    let taskTokens = 0
    if (state.llmSettings.selectedTaskId) {
      const tm = await tystate.getTaskManager()
      // we are getting quiet a few tasks here  in order to catch at least one chatCompletion task...
      const chain = await tm.getTaskIdChain(state.llmSettings.selectedTaskId, 15)

      // Assume the task with the last available token count is the relevant one
      for (const taskId of chain) {
        const taskMeta = await tm.debugDb.get(taskId)
        taskTokens = taskMeta?.taskTokens ?? 0
        if (taskTokens === 0) {
          taskTokens =
            (taskMeta?.estimatedTokens?.promptTokens ?? 0) +
            (taskMeta?.estimatedTokens?.resultTokens ?? 0)
        }
        if (taskTokens != 0) break
      }
    }

    // we need to deepCopy both ref values, so that we can send them to the thread!!
    const estimated = await estimateChatTokens(
      deepCopy(currentnewTask.value.content),
      // we don't do the next one, as we are already taking the actual prompt tokens
      // from a  previous task
      [] as OpenAI.ChatCompletionMessageParam[],
      deepCopy(toolCollection.value),
      deepCopy(state.llmSettings.allowedTools),
    )

    const newTokens = Object.values(estimated || {}).reduce((pn, cn) => (pn ?? 0) + (cn ?? 0), 0)

    // Tokenize the message
    estimatedTokens.value = taskTokens + (newTokens ?? 0)
  },
  { debounce: 1000, maxWait: 1500, immediate: true },
)

async function addFiles2Taskyon(newFiles: File[]) {
  console.log('add files to our chat!')
  //first, upload file into our OPFS file system:
  const opfsMapping = await saveUserUploadedFileToOpfs(newFiles)

  // Collect UUIDs from added files
  const uuids = []
  const tm = await tystate.getTaskManager()
  for (const [fileIdx, file] of newFiles.entries()) {
    const uuid = await tm.addFile({
      ...(opfsMapping[fileIdx] ? { opfs: opfsMapping[fileIdx] } : {}),
      name: file.name,
      fileType: file.type,
    })
    if (uuid) {
      uuids.push(uuid)
    }
  }
  return uuids
}

// all our files are added to a "file task"
async function createFileTask(files: File[]) {
  // first add files to our DB & save them, then get uuids for each file.
  const fileUuids = await addFiles2Taskyon(files)

  if (fileUuids.length) {
    const task: partialTaskDraft = {
      role: 'system',
      content: {
        type: 'files',
        data: fileUuids,
      },
    }
    return task
  }
  return undefined
}

async function addNewTask(execute = true) {
  // make sure we reset our execution context interrupt We do this right before adding another
  // task, because we want to make sure that
  tystate.taskWorkerController.reset()
  const tm = await tystate.getTaskManager()
  const fileTaskObj = await createFileTask(fileAttachments.value)

  // we are creating new taskchain accordig to what the user wants ;)
  // sometimes its several tasks in one go...
  const newTaskChain: partialTaskDraft[] = []

  if (fileTaskObj) {
    console.log('add files to chat:', fileTaskObj)
    newTaskChain.push(fileTaskObj)
    fileAttachments.value = [] // clear out fileAttachments for the next task
  }

  // execute: if true, we immediatly queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task, execute?', execute)
  // we are doing the ... to make sure we don't change the original, reactive object
  newTaskChain.push({ ...currentnewTask.value })

  if (currentnewTask.value.content.type === 'message') {
    if (state.llmSettings.enableToolChooser) {
      const chooseTask = createToolTask({
        name: 'chooseTool',
        arguments: {},
      })
      newTaskChain.push(chooseTask)
      console.log('adding message completion task:', currentnewTask.value.content.data)
    } else {
      const completionTask = createChatCompletionTask({
        model: currentModel.value,
        allowedTools: state.llmSettings.allowedTools || [],
        goal: state.llmSettings.allowedTools.length == 0 ? 'SimpleCompletion' : 'ChooseTool',
      })
      newTaskChain.push(completionTask)
      console.log('adding message completion task:', currentnewTask.value.content.data)
    }
  }

  // add taskchain to taskManager
  const newTaskId = (await tm.addTaskChain(newTaskChain, state.llmSettings.selectedTaskId)).at(-1)

  // push the last task to execution queue right away...
  if (execute && newTaskId) {
    void tystate.addToProcessQueue(newTaskId.id)
  }

  state.llmSettings.selectedTaskId = newTaskId?.id

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    state.llmSettings.taskDraft.content = { type: 'message', data: '' }
    await setTaskType(undefined)
  }
}

function attachFileToDraft(newFiles: File[]) {
  console.log('attach file to chat')
  fileAttachments.value.push(...newFiles)
}
</script>
