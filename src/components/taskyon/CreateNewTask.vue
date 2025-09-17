<template>
  <!--Create new task area-->
  <div style="position: relative" class="create-tasks">
    <!--Function Control-->
    <div v-if="selectedTaskType" class="text-caption text-center">
      <InfoDialog
        size="sm"
        flat
        :round="false"
        no-caps
        :icon="mdiFunctionVariant"
        :label="selectedTaskType"
        content-class="text-caption"
        :info-text="
          tystate.allTools[selectedTaskType]?.longDescription ??
          tystate.allTools[selectedTaskType]?.description ??
          'Error: no description available'
        "
      >
      </InfoDialog>
    </div>
    <!--Task Creation-->
    <div>
      <!-- in case we simply want to send simple messages :)-->
      <chatMessageEdit
        v-if="!selectedTaskType"
        v-model="state.messageDraft"
        :debounce="0"
        :class="['text-body1 ty-msg-edit', $q.dark.isActive ? 'text-white' : 'text-primary']"
        :use-enter-to-send="state.appConfiguration.useEnterToSend"
        @execute-task="addNewTask"
      >
        <template #left="{ btnSize }">
          <div v-if="minMode">
            <FileDropzone
              class="col fit row items-center q-px-xs"
              accept="*"
              enable-menu
              enable-paste
              disable-dropzone-border
              aria-label="attachFileToDraft"
              @add-files="attachFileToDraft"
            >
              <q-btn dense flat :size="btnSize">
                <q-icon :name="matAttachment" />
                <q-tooltip>Attach file or image to message</q-tooltip>
              </q-btn>
            </FileDropzone>
          </div>
        </template>
        <template #top="{ btnSize }">
          <q-btn
            v-if="(state.messageDraft?.length ?? 0) > 0"
            flat
            dense
            :size="btnSize"
            :icon="symOutlinedCancel"
            @click="state.messageDraft = ''"
          ></q-btn>
        </template>
      </chatMessageEdit>
      <!--If we want to edit any pre-defined functions we can do that here...-->
      <div v-else-if="selectedTaskType" class="row">
        <ObjectTreeView
          v-model="state.draftParameters[selectedTaskType]"
          class="col"
          input-field-behavior="auto"
          :separate-labels="false"
          :schema="functionSchema"
        />
        <q-btn
          v-if="state.appConfiguration.expertMode"
          flat
          dense
          size="sm"
          :icon="matBuild"
          :to="`/tool/${selectedTaskType}`"
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
        @remove="removeFileFromDraft(file)"
      >
        <div class="ellipsis" style="max-width: 100px">
          {{ `${file.name}` }}
        </div>
        <q-tooltip :delay="0.5">{{ `${file.name}` }}</q-tooltip>
      </q-chip>
    </div>
    <!--Task Creation State-->
    <div v-if="!minMode" class="q-px-sm q-pt-xs row justify-between items-center">
      <div class="col-auto row">
        <!--attach files...-->
        <FileDropzone
          class="col-auto"
          accept="*"
          enable-paste
          enable-menu
          disable-dropzone-border
          aria-label="attachFileToDraft"
          @add-files="attachFileToDraft"
        >
          <q-btn dense class="fit" flat>
            <q-icon :name="matAttachment" />
            <q-tooltip>Attach file or image to message</q-tooltip>
          </q-btn>
        </FileDropzone>
        <!--Taskyon features-->
        <ResponsiveMenuDialogBtn
          dense
          flat
          :icon="matMoreHoriz"
          maximized
          auto-close
          data-cy-menu="ai-settings"
          aria-label="quick ai settings"
        >
          <template #btnContent><q-tooltip> More AI Settings</q-tooltip></template>
          <div class="q-pa-sm">
            <ObjectTreeView
              v-model="slimSettings.reactiveView"
              :schema="slimSettings.jsonSchema"
              dense
            />
          </div>
          <q-card-actions class="float-right">
            <q-btn
              v-if="expertMode"
              flat
              to="/settings/agent%20config"
              label="Full list of settings"
            />
            <q-btn v-close-popup flat label="Ok" />
          </q-card-actions>
        </ResponsiveMenuDialogBtn>
        <!--Select Tools-->
        <ResponsiveMenuDialogBtn
          v-if="expertMode || selectedTaskType"
          dense
          flat
          :icon="mdiFunctionVariant"
          maximized
          data-cy="tool-btn"
          auto-close
        >
          <template #default="{ close }">
            <q-list dense>
              <q-item v-if="!selectedTaskType" clickable to="/tool" class="q-mb-md">
                <q-item-section avatar>
                  <q-icon :name="mdiToolbox"></q-icon>
                </q-item-section>
                <q-item-section> Open Tool Manager </q-item-section>
              </q-item>
              <q-item>
                <q-item-section class="text-caption">
                  Search for a tool you want to use..</q-item-section
                >
                <q-item-section side>
                  <InfoDialog
                    info-text="You can use tools here directly and change their parameters to your liking"
                  />
                </q-item-section>
              </q-item>
              <q-item class="row">
                <q-item-section @click.stop>
                  <q-select
                    class="col"
                    use-input
                    dense
                    standout
                    hide-selected
                    fill-input
                    options-dense
                    input-debounce="0"
                    color="secondary"
                    :model-value="selectedTaskType"
                    :options="filteredToolCollection"
                    @filter="filterFn"
                    @update:model-value="
                      (val) => {
                        tystate.switchTaskType(val)
                        close()
                      }
                    "
                  >
                  </q-select>
                </q-item-section>
              </q-item>
              <q-item
                v-if="selectedTaskType"
                class="q-mt-md"
                clickable
                @click="() => tystate.switchTaskType(undefined)"
              >
                <q-item-section avatar>
                  <q-icon :name="matChat"></q-icon>
                </q-item-section>
                <q-item-section> Select Simple Chat </q-item-section>
              </q-item>
            </q-list>
            <q-card-actions v-if="$q.platform.is.mobile" class="float-right">
              <q-btn v-close-popup flat label="Ok" />
            </q-card-actions>
          </template>
        </ResponsiveMenuDialogBtn>
      </div>
      <!--
          <div v-else-if="expertMode">
            <q-btn dense flat :icon="mdiFunctionVariant" @click="" />
          </div>
        -->
      <!--Choose Model-->
      <ResponsiveMenuDialogBtn
        size="sm"
        no-caps
        class="col-auto model-history"
        dense
        flat
        maximized
        data-cy-menu="model-selection"
      >
        <template #btnContent>
          <q-icon :name="matSmartToy" />
          <div data-cy="model-id" class="q-pl-xs ellipsis">
            {{ `${tystate.currentModelId}` }}
          </div>
          <div class="text-weight-thin gt-xs">/{{ state.llmSettings.selectedApi }}</div>
        </template>
        <template #default="{ close }">
          <q-list dense style="min-width: 100px">
            <div class="row">
              <q-btn square flat :icon="matSmartToy" label="Model List" to="/pricing" />
              <ApiSelect v-model="state.llmSettings.selectedApi" more-settings />
            </div>
            <q-separator />
            <q-item-label header>Previously selected AI models!</q-item-label>
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
            <q-separator />
            <div class="text-info column items-center">
              <div>
                <q-item class="row items-center">
                  <q-icon :name="matSmartToy" size="sm" class="q-pr-md"></q-icon>
                  <ModelSelection
                    v-model:selected-api="selectedApi"
                    class="col"
                    :bot-name="tystate.currentModelId"
                    :model-list="expertMode"
                    :select-api="expertMode"
                    @update-bot-name="
                      (bot) => {
                        tystate.handleBotNameUpdate(bot)
                        close()
                      }
                    "
                  ></ModelSelection>
                </q-item>
              </div>
              <InfoDialog
                v-if="tystate.currentModelId && tystate.currentModel?.description"
                :round="false"
                class="fit"
                square
                :dense="false"
                label="Info about current model"
                no-caps
                :info-text="tystate.currentModel?.description || ''"
              />
            </div>
          </q-list>
          <q-card-actions v-if="$q.platform.is.mobile" class="float-right">
            <q-btn v-close-popup flat label="Ok" />
          </q-card-actions>
        </template>
      </ResponsiveMenuDialogBtn>
      <!--Tool task execution-->
      <div
        v-if="expertMode && selectedTaskType"
        class="col-auto q-px-md row no-wrap items-center"
        @click.stop
      >
        <q-btn flat :icon-right="matSend" @click="addNewTask">
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
</template>

<script setup lang="ts">
import {
  matAttachment,
  matBuild,
  matChat,
  matMoreHoriz,
  matSend,
  matSmartToy,
  matUploadFile,
} from '@quasar/extras/material-icons'
import { symOutlinedCancel } from '@quasar/extras/material-symbols-outlined'
import { mdiFunctionVariant, mdiToolbox } from '@quasar/extras/mdi-v6'
import { partialTaskDraft } from '@taskyon/taskyon'
import { watchThrottled } from '@vueuse/core'
import ModelSelection from 'components/taskyon/ModelSelection.vue'
import { QSelect } from 'quasar'
import { generateTaskKeyWords } from 'src/modules/taskyon/taskUtils'
import { appConfiguration, llmSettings } from 'src/modules/taskyon/types'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'
import { deepCopy } from 'src/modules/utils'
import { buildSlimView } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, onMounted, ref, toRefs } from 'vue'
import FileDropzone from '../FileDropzone.vue'
import InfoDialog from '../InfoDialog.vue'
import ObjectTreeView from '../ObjectTreeView.vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'
import ApiSelect from './ApiSelect.vue'
import chatMessageEdit from './chatMessageEdit.vue'
// import { watchThrottled } from '@vueuse/core'
// use idel mechanism to calculate all kinds of stuff here :=)
//import { useIdle } from '@vueuse/core'

const { expertMode = false, entryNode } = defineProps<{
  entryNode: partialTaskDraft
  minMode?: boolean
  expertMode?: boolean
}>()

const fileAttachments = defineModel<File[]>('fileAttachments', { default: [] })

const state = useAppStateStore()
const tystate = useTaskyonStore()
const { selectedApi } = toRefs(state.llmSettings)

const keywordExtractorReady = ref(false)

onMounted(() => {
  // pre-load our python-based keyword function!
  void generateTaskKeyWords(
    currentnewTask.value ?? {
      role: 'system',
      content: { type: 'message', data: 'test' },
    },
    [],
  ).then(() => (keywordExtractorReady.value = true))
})

//const selectedTaskTypeVar = ref<string>('testasdad')

const em = computed(() => state.appConfiguration.expertMode)

const slimSettings = computed(() =>
  buildSlimView(
    {
      obj: state.appConfiguration,
      schema: appConfiguration,
      pickKeys: ['expertMode'],
    },
    {
      obj: state.llmSettings,
      schema: llmSettings,
      pickKeys: [
        ...(em.value
          ? ['enableToolChooser', 'enableOpenAiTools', 'tryUsingVisionModels', 'useBasePrompt']
          : []),
      ],
    },
    {
      obj: state.appConfiguration,
      schema: appConfiguration,
      pickKeys: ['primaryColor', 'secondaryColor'],
    },
  ),
)

// we initialize our taskDraft with the state of this window!

//const funcArgs = computed(() => );

const toolNames = computed(() => Object.keys(tystate.allTools))
const filteredToolCollection = ref<string[]>([])

const selectedTaskType = computed(() => {
  return state.createTaskType.type === 'functioncall' ? state.createTaskType.name : undefined
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
    const tool = tystate.allTools[selectedTaskType.value]
    if (!tool || !tool.parameters) {
      return undefined
    }
    return tool.parameters
  }
  return undefined
})

const currentnewTask = computed(() => {
  const task = {} as partialTaskDraft
  if (tystate.currentModelId) {
    task.name = undefined
    if (state.createTaskType.type === 'functioncall') {
      // here we have a function task ;)
      task.role = 'function'
      // we do this to make suere we *only* have a functionCall and not a message
      // or other things as well...
      task.content = {
        type: 'functioncall',
        data: {
          name: state.createTaskType.name,
          arguments: state.draftParameters[state.createTaskType.name] || {},
        },
      }
    } else if (state.createTaskType.type === 'message') {
      task.role = 'user'
      task.content = {
        type: 'message',
        data: state.messageDraft?.trim() ?? '',
      }
    } else {
      console.error('we currently only support function calls and messages as task types!')
      return undefined
    }
  }
  return partialTaskDraft.parse(task) // we can do this, because we defined the "role"
})

const getCurrentKeywords = async () => {
  const startTime = performance.now()
  const kwd = (await generateTaskKeyWords(currentnewTask.value, tystate.selectedThread.value))[0]
  const endTime = performance.now()
  console.log(`Keyword creation took ${endTime - startTime} ms.`)
  return kwd
}

// add taskchain to taskManager

async function getCurrentKeywordsWithTimeout(timeoutMs = 200) {
  const kwds = await Promise.race([
    getCurrentKeywords(),
    new Promise<null>((resolve) =>
      setTimeout(() => {
        resolve(null)
      }, timeoutMs),
    ),
  ])
  console.log(`Keyword Timeout? ${kwds === null ? true : false}`)
  return kwds
}

//const { idle, lastActive } = useIdle(2000) // 5 min
const currentKeywords = ref<string>()
watchThrottled(
  tystate.selectedThread,
  async () => {
    // calculate keywords here with much biggger timeout!
    const kwds = await getCurrentKeywordsWithTimeout(2000)
    if (kwds) currentKeywords.value = kwds
  },
  { immediate: true, throttle: 2000 },
)

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
    )

    const newTokens = Object.values(estimated || {}).reduce((pn, cn) => (pn ?? 0) + (cn ?? 0), 0)

    // Tokenize the message
    estimatedTokens.value = taskTokens + (newTokens ?? 0)
  },
  { debounce: 3000, maxWait: 5000, immediate: true },
)*/

// all our files are added to a "file task"
async function createFileTask(files: File[]) {
  const tm = await tystate.getTaskManager()

  // first add files to our DB & save them, then get uuids for each file.
  const fileUuids = await tm.addFiles(files)

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

async function addNewTask() {
  const kwdsPromise = getCurrentKeywordsWithTimeout(300)
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
  console.log('adding new task...')
  if (!currentnewTask.value) throw new Error('No task to add!')

  // we are doing the ... to make sure we don't change the original, reactive object
  newTaskChain.push({ ...currentnewTask.value })

  if (currentnewTask.value.content.type === 'message') {
    if (state.llmSettings.enableToolChooser) {
      const chooseTask = deepCopy(entryNode)
      newTaskChain.push(chooseTask)
      console.log('adding message completion task:', currentnewTask.value.content.data)
    } else {
      const completionTask = createChatCompletionTask({
        model: tystate.currentModelId,
        goal: 'SimpleCompletion',
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

  const kwds = (await kwdsPromise) ?? currentKeywords.value
  if (kwds) newTaskChain.forEach((t) => (t.name = kwds))
  const newTaskId = (await tm.addTaskChain(newTaskChain, state.llmSettings.selectedTaskId)).at(-1)

  // push the last task to execution queue right away...
  if (newTaskId) {
    void tystate.addToProcessQueue(newTaskId.id)
  }

  state.setSelectedTask(newTaskId?.id)

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    tystate.setNewContentDraft({ type: 'message', data: '' })
  }
}

function attachFileToDraft(newFiles: File[]) {
  console.log('attach file to chat')
  fileAttachments.value.push(...newFiles)
}

const removeFileFromDraft = (file: File) => {
  const index = fileAttachments.value.indexOf(file)
  if (index > -1) {
    fileAttachments.value.splice(index, 1)
  }
}
</script>

<style>
.model-history .ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  /* flex settings to allow proper truncation: */
  flex: 1 1 0; /* grow:1, shrink:1, basis:0 */
  min-width: 0; /* allow it to shrink below its content width */
  width: 100%;
}
</style>
