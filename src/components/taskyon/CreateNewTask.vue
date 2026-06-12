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
        @execute-task="addNewTask('message', p2pTopic)"
        @execute-web-search="addNewTask('websearch', p2pTopic)"
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
        <q-btn flat :icon-right="matSend" @click="addNewTask('message', p2pTopic)">
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
import {
  createNewTaskChain,
  generateTaskKeyWords,
  partialTaskDraft,
  type MessageExecutionMode,
} from '@taskyon/taskyon'
import { watchThrottled } from '@vueuse/core'
import { QSelect, useQuasar } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import type { ReadonlyDeep } from 'type-fest'
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
} = defineProps<{
  entryNode?: ReadonlyDeep<partialTaskDraft> | undefined
  minMode?: boolean
  expertMode?: boolean
  p2pTopic?: string // the p2p network that we want to send the task to
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
      // we do this to make sure we *only* have a functionCall and not a message
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

const $q = useQuasar()

async function addNewTask(mode: MessageExecutionMode, p2pTopic?: string) {
  console.log('pubishing on topic:', p2pTopic)
  const kwdsPromise = getCurrentKeywordsWithTimeout(300)

  // execute: if true, we immediately queue the task for execution in the taskManager
  //          otherwise, it won't get executed but simply saved into the tree
  console.log('adding new task...')
  if (!currentnewTask.value) throw new Error('No task to add!')
  const ty = await tystate.taskyon
  const fileIds = await ty.addFiles(fileAttachments.value, 'opfs')
  const kwds = (await kwdsPromise) ?? currentKeywords.value
  const createTaskChainArgs = {
    currentTask: tystate.currentTask.value,
    draftTask: currentnewTask.value,
    entryNode: entryNode ? partialTaskDraft.parse(structuredClone(entryNode)) : undefined,
    fileIds,
    keyword: kwds,
    mode,
  }
  const { createdTasks } = await createNewTaskChain({
    ...createTaskChainArgs,
    priorTaskId: state.llmSettings.selectedTaskId,
  })
  const newTaskId = createdTasks.at(-1)

  if (newTaskId) {
    tystate.api.send({
      type: 'tasks',
      tasks: createdTasks,
      execute: true,
      show: true,
      origin: window.location.origin,
    })
  }

  state.setSelectedTask(newTaskId?.id)

  // and empty out the contents for the next chat message :)
  if (currentnewTask.value.role === 'user') {
    tystate.setNewContentDraft({ type: 'message', data: '' })
    fileAttachments.value = []
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
