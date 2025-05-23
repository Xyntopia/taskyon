<template>
  <!--Create new task area-->
  <div class="create-new-task">
    <!--Task Creation-->
    <div>
      <!--Task Editing area-->
      <div>
        <!-- in case we simply want to send simple messages :)-->
        <chatMessageEdit
          v-if="!selectedTaskType && currentnewTask.content.type === 'message'"
          class="text-body1"
          :model-value="currentnewTask.content.data"
          :use-enter-to-send="state.appConfiguration.useEnterToSend"
          @update:model-value="updateContent"
          @execute-task="addNewTask"
        />
        <!--If we want to edit any pre-defined functions we can do that here...-->
        <div
          v-else-if="selectedTaskType && currentnewTask.content.type === 'functioncall'"
          class="row"
        >
          <ObjectTreeView
            v-model="currentnewTask.content.data.arguments"
            class="col"
            input-field-behavior="auto"
            :separate-labels="false"
            :schema="functionSchema"
          />
        </div>
      </div>
      <!--show attached files-->
      <div v-if="fileAttachments.length">
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
      <!--Task Creation State-->
      <div v-if="!hideTaskInfo" class="q-px-sm q-pt-xs">
        <div class="row items-center">
          <!--attach files...-->
          <FileDropzone class="col-auto" accept="*" enable-paste @add-files="attachFileToDraft">
            <q-btn dense class="fit" flat>
              <q-icon :name="matAttachment" />
              <q-tooltip>Attach file or image to message</q-tooltip>
            </q-btn>
          </FileDropzone>
          <!--Taskyon features-->
          <div class="col-auto row">
            <div>
              <q-tooltip>More AI Settings</q-tooltip>
              <FormDialog
                title="AI Settings"
                dense
                flat
                :icon="matMoreHoriz"
                :schema="slimSettings.jsonSchema"
                v-model="slimSettings.reactiveView"
              >
                <template #before>
                  Change some settings for taskyon here. For a full list of settings, please check
                  the <router-link to="/settings/agent%20config">settings page</router-link>.
                </template>
                <template #after>
                  <q-item class="row items-center">
                    <q-icon :name="matSmartToy" size="sm" class="q-pr-md"></q-icon>
                    <ModelSelection
                      v-model:selected-api="selectedApi"
                      class="col"
                      :bot-name="tystate.currentModelId"
                      :model-list="expertMode"
                      :select-api="expertMode"
                      @update-bot-name="tystate.handleBotNameUpdate"
                      @click.stop
                    ></ModelSelection>
                  </q-item>
                </template>
              </FormDialog>
            </div>
          </div>
          <!--Task type selection and execution-->
          <div class="col-auto">
            <q-btn
              v-if="selectedTaskType"
              flat
              dense
              :icon="matChat"
              @click="setTaskType(undefined)"
              ><q-tooltip>Select Simple Chat</q-tooltip>
            </q-btn>
          </div>
          <div v-if="expertMode" class="col-auto q-px-md">
            <!--q-select
              :model-value="selectedTaskType || ''"
              :options="toolNames"
              @update:model-value="setTaskType"
              use-input
            /-->
            <q-select
              class="col"
              use-input
              fill-input
              dense
              options-dense
              input-debounce="0"
              borderless
              @filter="filterFn"
              color="secondary"
              :model-value="selectedTaskType"
              :options="filteredToolCollection"
              :label="selectedTaskType ? 'selected Tool' : 'Select Tool'"
              @update:model-value="setTaskType"
              behavior="default"
            />
          </div>
          <!--
          <div v-else-if="expertMode">
            <q-btn dense flat :icon="mdiFunctionVariant" @click="" />
          </div>
        -->
          <!--Choose Model-->
          <div class="col-auto row q-px-md">
            <info-dialog
              v-if="tystate.currentModelId && tystate.currentModel?.description"
              size="xs"
              :info-text="tystate.currentModel?.description || ''"
            />
            <q-btn flat dense size="sm" no-caps>
              <q-icon :name="matSmartToy" class="q-px-xs" />
              <div class="ellipsis">
                {{ `${tystate.currentModelId}` }}
              </div>
              <div class="text-weight-thin gt-xs">/{{ state.llmSettings.selectedApi }}</div>
              <q-tooltip>Select AI model (current model: {{ tystate.currentModelId }})</q-tooltip>
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
                    @click="tystate.handleBotNameUpdate({ newName: m })"
                  >
                    <q-item-section>{{ state.modelHistory.length - idx }}: {{ m }}</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable>
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
          <div class="col-auto">
            <q-btn
              v-if="selectedTaskType"
              class="q-ma-md"
              flat
              :icon-right="matSend"
              @click="addNewTask()"
            >
              <q-tooltip>Execute Task</q-tooltip>
            </q-btn>
          </div>
          <!-- deactivate token estimation for now, because
           when using agents this is way too hard to estimate.
          <template v-if="tystate.currentModelId && expertMode && false">
            <div class="gt-xs">
              {{ `t/c: ${estimatedTokens}/${tystate.currentModel?.context_length}` }}
              <q-tooltip :delay="1000" class="q-gutter-sm">
                <div>
                  [approximate number of tokens in prompt] / [max number of tokens which AI can
                  understand]
                </div>
                <div>Tokens are roughly similar to syllables.</div>
              </q-tooltip>
            </div>
            <div class="lt-sm">{{ `t/c: ${estimatedTokens}` }}</div>
          </template>-->
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue'
import { createToolTask, getDefaultParametersForTool } from 'src/modules/taskyon/tools'
import { partialTaskDraft } from 'src/modules/taskyon/types'
import { llmSettings, appConfiguration } from 'src/modules/taskyon/types'
import { useTaskyonStore } from 'stores/taskyonState'
import type { FunctionArguments } from 'src/modules/taskyon/types'
import ModelSelection from 'components/taskyon/ModelSelection.vue'
import { saveUserUploadedFileToOpfs } from 'src/modules/OPFS'
import ObjectTreeView from '../ObjectTreeView.vue'
import chatMessageEdit from './chatMessageEdit.vue'
import InfoDialog from '../InfoDialog.vue'
import {
  matUploadFile,
  matChat,
  matSmartToy,
  matNavigateNext,
  matMoreHoriz,
  matAttachment,
  matSend,
} from '@quasar/extras/material-icons'
import { deepMerge } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'
import { asyncComputed } from 'src/modules/vueUtils'
import FormDialog from './FormDialog.vue'
import { buildSlimView } from 'src/modules/vueUtils'
import FileDropzone from '../FileDropzone.vue'
import { QSelect } from 'quasar'

const { expertMode = false, forceTaskProps } = defineProps<{
  forceTaskProps?: llmSettings['taskTemplate'] | undefined
  hideTaskInfo?: boolean
  expertMode?: boolean
}>()

const fileAttachments = defineModel<File[]>('fileAttachments', { default: [] })

function updateContent(value: string | null | undefined) {
  currentTaskDraft.value.content = {
    type: 'message',
    data: value || '',
  }
}

const state = useAppStateStore()
const tystate = useTaskyonStore()
const { selectedApi } = toRefs(state.llmSettings)

const slimSettings = buildSlimView(
  {
    obj: state.llmSettings,
    schema: llmSettings,
    pickKeys: ['enableToolChooser', 'enableOpenAiTools', 'tryUsingVisionModels', 'useBasePrompt'],
  },
  {
    obj: state.appConfiguration,
    schema: appConfiguration,
    pickKeys: ['useEnterToSend', 'primaryColor', 'secondaryColor'],
  },
)

// we initialize our taskDraft with the state of this window!

//const funcArgs = computed(() => );

async function getAllTools() {
  const foundTools = await (await tystate.getTaskManager()).updateToolDefinitions(true)
  return foundTools
}

const toolCollection = asyncComputed(getAllTools, {})
const toolNames = computed(() => Object.keys(toolCollection.value))
const filteredToolCollection = ref<string[]>([])

const currentTaskDraft = computed(() => {
  return state.llmSettings.taskDraft
})

const selectedTaskType = computed(() => {
  return currentnewTask.value.content.type === 'functioncall'
    ? currentnewTask.value.content.data.name
    : undefined
})

const filterFn = (inputValue: string, doneFn: (callbackFn: () => void) => void) => {
  if (inputValue === '') {
    doneFn(() => {
      filteredToolCollection.value = toolNames.value
    })
    return
  }

  doneFn(() => {
    const needle = inputValue.toLowerCase()
    filteredToolCollection.value = toolNames.value.filter(
      (v) => v.toLowerCase().indexOf(needle) > -1,
    )
  })
}

const functionSchema = computed(() => {
  if (selectedTaskType.value) {
    const tool = toolCollection.value[selectedTaskType.value]
    if (!tool || !tool.parameters) {
      return undefined
    }
    return tool.parameters
  }
  return undefined
})

async function setTaskType(tasktype: string | undefined | null) {
  console.log('change tasktype to:', tasktype)
  if (tasktype) {
    currentTaskDraft.value.role = 'function'
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
    currentTaskDraft.value.content = {
      type: 'functioncall',
      data: {
        name: tasktype,
        arguments: funcArguments,
      },
    }
  } else {
    currentTaskDraft.value.role = 'user'
    currentTaskDraft.value.content = {
      type: 'message',
      data: '',
    }
  }
}

const currentnewTask = computed(() => {
  const task = deepMerge(currentTaskDraft.value, forceTaskProps || {})
  if (tystate.currentModelId) {
    task.name = undefined
    if (
      currentTaskDraft.value.content.type === 'functioncall' &&
      currentTaskDraft.value.content.data.name
    ) {
      // here we have a function task ;)
      task.role = 'function'
      // we do this to make suere we *only* have a functionCall and not a message
      // or other things as well...
      task.content = {
        type: 'functioncall',
        data: currentTaskDraft.value.content.data,
      }
    } else if (currentTaskDraft.value.content.type === 'message') {
      task.role = 'user'
      task.content = {
        type: 'message',
        data: currentTaskDraft.value.content.data.trim(),
      }
    } else {
      task.role = 'user'
      task.content = {
        type: 'message',
        data: JSON.stringify(currentTaskDraft.value.content.data, null, 2),
      }
    }
  }
  return partialTaskDraft.parse(task) // we can do this, because we defined the "role"
})

//const { estimateChatTokens } = useNlpWorker()

// TODO:   our token estimation needs to become much better ^^
// TODO:   e.g. add prompts to our task :)
/*const estimatedTokens = ref<number>(0)
watchDebounced(
  [() => currentTaskDraft.value.content, () => state.llmSettings.selectedTaskId],
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
      [] as ChatCompletionMessageParam[],
      deepCopy(toolCollection.value),
      deepCopy(state.llmSettings.allowedTools),
    )

    const newTokens = Object.values(estimated || {}).reduce((pn, cn) => (pn ?? 0) + (cn ?? 0), 0)

    // Tokenize the message
    estimatedTokens.value = taskTokens + (newTokens ?? 0)
  },
  { debounce: 3000, maxWait: 5000, immediate: true },
)*/

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
        arguments: {
          llmTools: state.llmSettings.enableOpenAiTools,
        },
      })
      newTaskChain.push(chooseTask)
      console.log('adding message completion task:', currentnewTask.value.content.data)
    } else {
      const completionTask = createChatCompletionTask({
        model: tystate.currentModelId,
        llmTools: state.llmSettings.enableOpenAiTools,
        allowedTools: state.llmSettings.allowedTools || [],
        goal: state.llmSettings.allowedTools.length == 0 ? 'SimpleCompletion' : 'ChooseTool',
      })
      newTaskChain.push(completionTask)
      console.log('adding message completion task:', currentnewTask.value.content.data)
    }
  }

  // if we are attaching our task to an existing parent, we want to make sure that
  // the task doesn't wait for a previous task to be finished (e.g. if there was an error
  // or the task was cancelled by the user). So we are adding a return task which makes sure
  // taskyon knows that.
  if (tystate.currentTask.value && tystate.currentTask.value.content.type !== 'return') {
    // Add a return type task as the first task in the chain
    newTaskChain.unshift({
      role: 'system',
      content: {
        type: 'return',
        data: 'Function was cancelled for unknown reasons.',
      },
    })
  }

  // add taskchain to taskManager
  const newTaskId = (await tm.addTaskChain(newTaskChain, state.llmSettings.selectedTaskId)).at(-1)

  // push the last task to execution queue right away...
  if (execute && newTaskId) {
    void tystate.addToProcessQueue(newTaskId.id)
  }

  state.setSelectedTask(newTaskId?.id)

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    currentTaskDraft.value.content = { type: 'message', data: '' }
    await setTaskType(undefined)
  }
}

function attachFileToDraft(newFiles: File[]) {
  console.log('attach file to chat')
  fileAttachments.value.push(...newFiles)
}
</script>
