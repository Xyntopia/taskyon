<template>
  <!--Create new task area-->
  <div class="create-new-task">
    <!--Task Creation-->
    <div>
      <div>
        <taskContentEdit
          v-if="
            !selectedTaskType && !codingMode && 'message' in state.llmSettings.taskDraft.content
          "
          class="text-body1"
          :model-value="state.llmSettings.taskDraft.content.message"
          :execute-task="addNewTask"
          :attach-file-to-chat="attachFileToDraft"
          :use-enter-to-send="state.appConfiguration.useEnterToSend"
          @update:model-value="updateContent"
        />
        <div
          v-else-if="
            !selectedTaskType && codingMode && 'message' in state.llmSettings.taskDraft.content
          "
        >
          <CodeEditor
            :model-value="state.llmSettings.taskDraft.content.message"
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
          v-else-if="selectedTaskType && 'functionCall' in state.llmSettings.taskDraft.content"
          class="row"
        >
          <ObjectTreeView
            v-model="state.llmSettings.taskDraft.content.functionCall.arguments"
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
            <info-dialog
              v-if="currentModel && tystate.modelLookUp[currentModel]?.description"
              size="xs"
              :info-text="tystate.modelLookUp[currentModel]?.description || ''"
            />
            <q-btn flat dense size="sm" no-caps>
              <div class="ellipsis">
                {{ `${currentModel}` }}
              </div>
              <div class="text-weight-thin gt-xs">/{{ currentChatApi }}</div>
              <q-tooltip>Select AI Model</q-tooltip>
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
          <div v-if="currentModel" class="gt-xs">
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
        <ToggleButton
          v-if="expertMode"
          v-model="state.llmSettings.useBasePrompt"
          outline
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
        <!--Allowed Tools Selection-->
        <q-separator class="q-my-sm" />
        <q-item class="row items-center">
          <q-icon :name="mdiTools" size="sm" />
          <q-expansion-item
            v-model="state.allowedToolsExpand"
            class="col"
            dense
            :icon="matHandyman"
            expand-icon-toggle
            label="Tools"
          >
            <template #header>
              <div class="row items-center q-gutter-sm">
                <q-btn
                  dense
                  :icon="matChecklist"
                  label="toggle tools"
                  @click="toggleSelectedTools"
                />
                <q-btn
                  v-if="state.appConfiguration.expertMode"
                  dense
                  flat
                  :icon="matEdit"
                  label="> manage tools"
                  to="tools"
                />
              </div>
            </template>
            <q-item-section>
              <q-option-group
                v-model="state.llmSettings.allowedTools"
                class="q-ma-md"
                :options="
                  Object.keys(toolCollection).map((name) => ({
                    label: name,
                    value: name,
                    description: toolCollection[name]?.description,
                  }))
                "
                color="secondary"
                type="checkbox"
                inline
                dense
              >
                <template #label="opt">
                  <div>
                    {{ opt.label }}
                  </div>
                  <q-tooltip anchor="bottom middle" style="max-width: 500px">{{
                    opt.description
                  }}</q-tooltip>
                </template></q-option-group
              >
            </q-item-section>
          </q-expansion-item>
          <q-space />
          <taskSettingsButton v-model="expandedTaskCreation" />
        </q-item>
      </q-list>
    </q-slide-transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, toRefs } from 'vue'
import { getDefaultParametersForTool } from 'src/modules/taskyon/tools'
import type { FunctionArguments, partialTaskDraft, ToolBase } from 'src/modules/taskyon/types'
import { getApiConfig, llmSettings } from 'src/modules/taskyon/types'
import '@quasar/quasar-ui-qmarkdown/dist/index.css'
import { useTaskyonStore } from 'stores/taskyonState'
import type { TaskNode } from 'src/modules/taskyon/types'
import ModelSelection from 'components/taskyon/ModelSelection.vue'
import { writeFilesToOpfs } from 'src/modules/OPFS'
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
  matHandyman,
  matEdit,
  matChecklist,
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
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import { useNlpWorker } from 'src/modules/taskyon/webWorkerApi'
import { useAppStateStore } from 'src/stores/appState'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'

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
  forceTaskProps?: llmSettings['taskTemplate']
  sendAllowed?: boolean
  hideTaskInfo?: boolean
}>()

function updateContent(value: string | null | undefined) {
  state.llmSettings.taskDraft.content = {
    message: value || '',
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
// TODO: we can move this into taskyonstate?
const currentModel = computed(() => {
  const api = getApiConfig(state.llmSettings)
  if (api) {
    const modelName =
      api.selectedModel || api.defaultModel || api.models?.free || 'No model selected!'
    return modelName
  }
  return 'No model selected!'
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
  if (task.content && 'functionCall' in task.content) {
    return task.content.functionCall.name
  }
  return undefined
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
      ...state.llmSettings.taskDraft.content,
      functionCall: {
        name: tasktype,
        arguments: funcArguments,
      },
    }
  } else {
    state.llmSettings.taskDraft.role = 'user'
    state.llmSettings.taskDraft.content = {
      message: '',
    }
  }
}

async function toggleSelectedTools() {
  if (state.llmSettings.allowedTools) {
    if (state.llmSettings.allowedTools.length > 0) {
      state.llmSettings.allowedTools = []
      return
    }
  }
  state.llmSettings.allowedTools = Object.keys(await getAllTools())
}

const currentnewTask = computed(() => {
  const task = deepMerge(state.llmSettings.taskDraft, props.forceTaskProps || {})
  if (currentModel.value) {
    task.name = undefined
    task.debugging = {}
    if (selectedTaskType.value && 'functionCall' in state.llmSettings.taskDraft.content) {
      // here we have a function task ;)
      task.role = 'function'
      // we do this to make suere we *only* have a functionCall and not a message
      // or other things as well...
      task.content = {
        functionCall: state.llmSettings.taskDraft.content.functionCall,
      }
    } else if (
      state.llmSettings.taskDraft.content &&
      'message' in state.llmSettings.taskDraft.content
    ) {
      task.role = 'user'
      task.content = {
        message: state.llmSettings.taskDraft.content.message.trim(),
      }
    }
  }
  return task as TaskNode // we can do this, because we defined the "role"
})

const { estimateChatTokens } = useNlpWorker()

// TODO:   our token estimation needs to become much better ^^
const estimatedTokens = ref<number>(0)
watchDebounced(
  [() => state.llmSettings.taskDraft.content, () => state.llmSettings.selectedTaskId],
  async () => {
    let accumulatedTokens = 0
    let accumulatedEstimated = 0
    let messages: ChatCompletionMessageParam[] = []
    if (state.llmSettings.selectedTaskId) {
      const tm = await tystate.getTaskManager()
      // we only need the last 2 or 3 tasks in order to check for
      const chain = await tm.getTaskIdChain(state.llmSettings.selectedTaskId, 3)

      // Assume the highest token count is the last relevant one
      for (const taskId of chain) {
        const task = await tm.getTask(taskId)
        const taskTokens = task?.debugging.taskTokens ?? 0
        const taskTokensEstimated =
          (task?.debugging.estimatedTokens?.promptTokens ?? 0) +
          (task?.debugging.estimatedTokens?.resultTokens ?? 0)
        if (taskTokens > accumulatedTokens) {
          accumulatedTokens = taskTokens
        }
        if (taskTokensEstimated > accumulatedEstimated) {
          accumulatedEstimated = taskTokensEstimated
        }
      }
    } else {
      //messages = addPrompts(currentnewTask.value, toolCollection.value, state.llmSettings, [], [])
      console.warn(
        'TODO: get rid of this, we would rather simply "simulate" the entire chat using the actual chat tool...',
      )
      messages = []
    }

    // we need to deepCopy both ref values, so that we can send them to the thread!!
    const estimated = await estimateChatTokens(
      deepCopy(currentnewTask.value),
      messages,
      deepCopy(toolCollection.value),
      deepCopy(state.llmSettings.allowedTools),
    )

    const newTokens = Object.values(estimated || {}).reduce((pn, cn) => (pn ?? 0) + (cn ?? 0), 0)

    // Tokenize the message
    estimatedTokens.value = (accumulatedTokens || accumulatedEstimated) + (newTokens ?? 0)
  },
  { debounce: 1000, maxWait: 1500, immediate: true },
)

async function addFiles2Taskyon(newFiles: File[]) {
  console.log('add files to our chat!')
  //first, upload file into our OPFS file system:
  const opfsMapping = await writeFilesToOpfs(newFiles)

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
        uploadedFiles: fileUuids,
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

  if ('message' in currentnewTask.value.content) {
    const completionTask = createChatCompletionTask({
      model: currentModel.value,
      allowedTools: state.llmSettings.allowedTools || [],
      goal: state.llmSettings.allowedTools.length == 0 ? 'SimpleCompletion' : 'ChooseTool',
    })
    newTaskChain.push(completionTask)
    console.log('adding message completion task:', currentnewTask.value.content.message)
  }

  // add taskchain to taskManager
  const newTaskId = await tm.addTaskChain(newTaskChain, state.llmSettings.selectedTaskId)

  // push the last task to execution queue right away...
  if (execute && newTaskId) {
    const pq = await tystate.getTaskQueue()
    pq.push(newTaskId)
  }

  state.llmSettings.selectedTaskId = newTaskId

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    state.llmSettings.taskDraft.content = { message: '' }
    await setTaskType(undefined)
  }
}

function attachFileToDraft(newFiles: File[]) {
  console.log('attach file to chat')
  fileAttachments.value.push(...newFiles)
}
</script>
