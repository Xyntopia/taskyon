<template>
  <!--Create new task area-->
  <div class="create-tasks">
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
        :show-web-search="state.appConfiguration.webSearchButton"
        @execute-task="addNewTask(p2pTopic)"
        @execute-web-search="addNewTask(p2pTopic, true)"
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
        <ObjectView
          v-model="state.draftParameters[selectedTaskType]"
          class="col"
          input-field-behavior="auto"
          :separate-labels="false"
          :schema="functionSchema"
          missing-mode="placeholders"
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
        dense
        color="secondary"
        text-color="white"
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
        <SimpleSettingsDialog />
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
      <!--Choose Model-->
      <ChooseModelDialog />
      <!--Tool task execution-->
      <div
        v-if="expertMode && selectedTaskType"
        class="col-auto q-px-md row no-wrap items-center"
        @click.stop
      >
        <q-btn flat :icon-right="matSend" @click="addNewTask(p2pTopic)">
          <q-tooltip>Execute Task</q-tooltip>
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  matAttachment,
  matBuild,
  matChat,
  matSend,
  matUploadFile,
} from '@quasar/extras/material-icons'
import { symOutlinedCancel } from '@quasar/extras/material-symbols-outlined'
import { mdiFunctionVariant, mdiToolbox } from '@quasar/extras/mdi-v6'
import FileDropzone from '@taskyon/shared/components/FileDropzone.vue'
import InfoDialog from '@taskyon/shared/components/InfoDialog.vue'
import ResponsiveMenuDialogBtn from '@taskyon/shared/components/ResponsiveMenuDialogBtn.vue'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import { deepCopy, generateTaskKeyWords, partialTaskDraft } from '@taskyon/taskyon'
import { watchThrottled } from '@vueuse/core'
import { QSelect, useQuasar } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import type { ReadonlyDeep, WritableDeep } from 'type-fest'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import chatMessageEdit from './chatMessageEdit.vue'
import ChooseModelDialog from './ChooseModelDialog.vue'
import SimpleSettingsDialog from './SimpleSettingsDialog.vue'
// import { watchThrottled } from '@vueuse/core'
// use idel mechanism to calculate all kinds of stuff here :=)
//import { useIdle } from '@vueuse/core'

const {
  expertMode = false,
  entryNode = undefined,
  p2pTopic = undefined,
  addToTaskyon,
} = defineProps<{
  entryNode?: ReadonlyDeep<partialTaskDraft> | undefined
  minMode?: boolean
  expertMode?: boolean
  p2pTopic?: string // the p2p network that we want to send the task to
  addToTaskyon?: boolean
}>()

const emit = defineEmits<{
  (e: 'addTasks', t: partialTaskDraft[]): void
}>()

const fileAttachments = defineModel<File[]>('fileAttachments', { default: [] })

const state = useAppStateStore()
const tystate = useTaskyonStore()

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

  state.setDraftPasteHandler((pastedFiles) => {
    attachFileToDraft(pastedFiles)
  })
})

onBeforeUnmount(() => {
  state.setDraftPasteHandler(null)
})

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

const getCurrentKeyword = async () => {
  const startTime = performance.now()
  const kwd = (await generateTaskKeyWords(currentnewTask.value, tystate.selectedThread))[0]
  const endTime = performance.now()
  console.log(`Keyword creation took ${endTime - startTime} ms.`)
  return kwd
}

// add taskchain to taskManager
async function getCurrentKeywordsWithTimeout(timeoutMs = 200): Promise<string | undefined | null> {
  try {
    const kwd = await Promise.race([
      getCurrentKeyword(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          resolve(null)
        }, timeoutMs),
      ),
    ])
    return kwd
  } catch (err) {
    console.log('Error generating keywords!', err)
  }
  //console.log(`Keyword Timeout? ${kwds === null ? true : false}`)
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

// all our files are added to a "file task"
async function createFileTask(files: File[]) {
  const ty = await tystate.taskyon

  // first add files to our DB & save them, then get uuids for each file.
  const fileUuids = await ty.addFiles(files, 'opfs')

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

const $q = useQuasar()

// TODO: move this "up", it would be better to have the task creation be purely
//       event based and more configurable...
async function addNewTask(p2pTopic?: string, webSearch?: boolean) {
  console.log('pubishing on topic:', p2pTopic)
  const kwdsPromise = getCurrentKeywordsWithTimeout(300)
  const ty = await tystate.taskyon

  const fileTaskObj = await createFileTask(fileAttachments.value)

  // we are creating new taskchain accordig to what the user wants ;)
  // sometimes its several tasks in one go...
  const newTaskChain: partialTaskDraft[] = []

  if (fileTaskObj) {
    console.log('add files to chat:', fileTaskObj)
    newTaskChain.push(fileTaskObj)
  }

  // execute: if true, we immediatly queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task...')
  if (!currentnewTask.value) throw new Error('No task to add!')

  // we are doing the ... to make sure we don't change the original, reactive object
  newTaskChain.push({ ...currentnewTask.value })

  if (currentnewTask.value.content.type === 'message') {
    if (entryNode) {
      const chooseTask = deepCopy(entryNode) as WritableDeep<partialTaskDraft>
      if (chooseTask.content.type === 'functioncall') {
        // TODO: in the future, we should make this "dynamic" and automatically add the relevant buttons
        // from our entry node to the task creation area!
        //  also move this into the toolChooser settings!
        chooseTask.content.data.arguments = {
          ...(webSearch ? { webSearch: true } : {}),
          ...(state.llmSettings.enableToolChooser ? { useTools: true } : {}),
        }
      }
      newTaskChain.push(chooseTask)
    } else {
      $q.notify(
        "We can can not complete the Chat because we don't have a correct model or provider selected",
      )
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

  // only add to taskyon, if
  if (addToTaskyon) {
    const newTaskId = (await ty.addTaskChain(newTaskChain, state.llmSettings.selectedTaskId)).at(-1)

    // push the last task to execution queue right away...
    if (newTaskId) {
      void tystate.addToProcessQueue(newTaskId.id)
    }

    state.setSelectedTask(newTaskId?.id)
  }

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    tystate.setNewContentDraft({ type: 'message', data: '' })
    fileAttachments.value = []
  }

  emit('addTasks', newTaskChain)
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
