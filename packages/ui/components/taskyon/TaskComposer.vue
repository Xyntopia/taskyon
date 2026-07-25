<template>
  <div :class="['create-tasks', { 'create-tasks--hero': heroMode }]">
    <div v-if="selectedTaskType" class="create-tasks__mode text-caption text-center">
      <InfoDialog
        size="sm"
        flat
        :round="false"
        no-caps
        :icon="mdiFunctionVariant"
        :label="selectedTaskType"
        content-class="text-caption"
        :info-text="
          allTools[selectedTaskType]?.longDescription ??
          allTools[selectedTaskType]?.description ??
          'Error: no description available'
        "
      />
    </div>
    <div class="create-tasks__input">
      <ChatMessageEdit
        v-if="!selectedTaskType"
        v-model="messageDraft"
        :debounce="0"
        :class="['text-body1 ty-msg-edit', $q.dark.isActive ? 'text-white' : 'text-primary']"
        :use-enter-to-send="useEnterToSend"
        :show-web-search="showWebSearch"
        :placeholder="heroMode ? 'Describe what you want to build' : 'Type your message...'"
        @execute-task="addNewTask('message')"
        @execute-web-search="addNewTask('websearch')"
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
            v-if="(messageDraft?.length ?? 0) > 0"
            flat
            dense
            :size="btnSize"
            :icon="symOutlinedCancel"
            @click="messageDraft = ''"
          />
        </template>
      </ChatMessageEdit>
      <div v-else class="row">
        <ObjectView
          v-model="draftParameters[selectedTaskType]"
          class="col"
          input-field-behavior="auto"
          :separate-labels="false"
          :schema="functionSchema"
          missing-mode="placeholders"
        />
        <slot name="tool-link" :tool-name="selectedTaskType" />
      </div>
    </div>
    <div v-if="fileAttachments.length" class="create-tasks__attachments row items-center">
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
          {{ file.name }}
        </div>
        <q-tooltip :delay="0.5">{{ file.name }}</q-tooltip>
      </q-chip>
    </div>
    <div v-if="!minMode" class="create-tasks__controls row items-center no-wrap">
      <div class="create-tasks__control-group row items-center no-wrap">
        <FileDropzone
          class="create-tasks__dropzone"
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
        <slot name="settings" />
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
              <slot name="tool-manager-item" />
              <q-item>
                <q-item-section class="text-caption"
                  >Search for a tool you want to use..</q-item-section
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
                        switchTaskType(val)
                        close()
                      }
                    "
                  />
                </q-item-section>
              </q-item>
              <q-item
                v-for="toolName in filteredToolCollection.length
                  ? filteredToolCollection
                  : toolNames"
                :key="toolName"
                clickable
                @click="
                  () => {
                    switchTaskType(toolName)
                    close()
                  }
                "
              >
                <q-item-section>{{ toolName }}</q-item-section>
              </q-item>
              <q-item
                v-if="selectedTaskType"
                class="q-mt-md"
                clickable
                @click="switchTaskType(undefined)"
              >
                <q-item-section avatar>
                  <q-icon :name="matChat" />
                </q-item-section>
                <q-item-section>Select Simple Chat</q-item-section>
              </q-item>
            </q-list>
            <q-card-actions v-if="$q.platform.is.mobile" class="float-right">
              <q-btn v-close-popup flat label="Ok" />
            </q-card-actions>
          </template>
        </ResponsiveMenuDialogBtn>
      </div>
      <div class="create-tasks__model-slot">
        <slot name="model" />
      </div>
      <div
        v-if="expertMode && selectedTaskType"
        class="create-tasks__execute row no-wrap items-center"
        @click.stop
      >
        <q-btn
          class="create-tasks__execute-button"
          flat
          :icon-right="matSend"
          @click="addNewTask('message')"
        >
          <q-tooltip>Execute Task</q-tooltip>
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matAttachment, matChat, matSend, matUploadFile } from '@quasar/extras/material-icons'
import { symOutlinedCancel } from '@quasar/extras/material-symbols-outlined'
import { mdiFunctionVariant } from '@quasar/extras/mdi-v6'
import {
  createNewTaskChain,
  getDefaultParametersForTool,
  partialTaskDraft,
  type FunctionArguments,
  type MessageExecutionMode,
  type TaskyonClient,
} from '@taskyon/taskyon'
import type { TaskNode, ToolBase } from '@taskyon/taskyon'
import { QSelect, useQuasar } from 'quasar'
import { computed, ref, toRaw } from 'vue'
import FileDropzone from '../FileDropzone.vue'
import InfoDialog from '../InfoDialog.vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'
import ObjectView from '../varViews/ObjectView.vue'
import ChatMessageEdit, { type UseEnterToSendMode } from './ChatMessageEdit.vue'

type TaskTypeSelection =
  | {
      type: 'message'
    }
  | {
      type: 'functioncall'
      name: string
    }

const props = withDefaults(
  defineProps<{
    client: TaskyonClient
    currentTask?: TaskNode | null
    selectedTaskId?: string | undefined
    entryNode?: partialTaskDraft | undefined
    allTools?: Record<string, ToolBase>
    minMode?: boolean
    expertMode?: boolean
    heroMode?: boolean
    useEnterToSend?: UseEnterToSendMode
    showWebSearch?: boolean
    navigateToTask?: ((taskId: string | undefined) => void) | undefined
    markTasksPendingCreation?: ((taskIds: readonly string[]) => void) | undefined
  }>(),
  {
    currentTask: null,
    selectedTaskId: undefined,
    entryNode: undefined,
    allTools: () => ({}),
    minMode: false,
    expertMode: false,
    heroMode: false,
    useEnterToSend: 'auto',
    showWebSearch: false,
    navigateToTask: undefined,
    markTasksPendingCreation: undefined,
  },
)

const emit = defineEmits<{
  (e: 'created', taskId: string | undefined, taskIds: readonly string[]): void
}>()

const fileAttachments = defineModel<File[]>('fileAttachments', { default: () => [] })
const messageDraft = defineModel<string | undefined>('messageDraft', { default: undefined })
const createTaskType = defineModel<TaskTypeSelection>('createTaskType', {
  default: () => ({ type: 'message' }),
})
const draftParameters = defineModel<Record<string, FunctionArguments>>('draftParameters', {
  default: () => ({}),
})

const $q = useQuasar()
const filteredToolCollection = ref<string[]>([])
const toolNames = computed(() => Object.keys(props.allTools))
const selectedTaskType = computed(() =>
  createTaskType.value.type === 'functioncall' ? createTaskType.value.name : undefined,
)
const functionSchema = computed(() =>
  selectedTaskType.value ? props.allTools[selectedTaskType.value]?.parameters : undefined,
)

const filterFn = (inputValue: string, doneFn: (callbackFn: () => void) => void) => {
  doneFn(() => {
    const needle = inputValue.toLowerCase()
    filteredToolCollection.value = inputValue
      ? toolNames.value.filter((value) => value.toLowerCase().includes(needle))
      : toolNames.value
  })
}

const switchTaskType = (taskType: string | undefined | null) => {
  if (taskType && draftParameters.value[taskType] === undefined) {
    const tool = props.allTools[taskType]
    if (!tool) return
    draftParameters.value = {
      ...draftParameters.value,
      [taskType]: getDefaultParametersForTool(tool),
    }
  }
  createTaskType.value = taskType
    ? {
        type: 'functioncall',
        name: taskType,
      }
    : { type: 'message' }
}

const currentNewTask = computed(() => {
  const task: partialTaskDraft =
    createTaskType.value.type === 'functioncall'
      ? {
          role: 'function',
          content: {
            type: 'functioncall',
            data: {
              name: createTaskType.value.name,
              arguments: draftParameters.value[createTaskType.value.name] || {},
            },
          },
        }
      : {
          role: 'user',
          content: {
            type: 'message',
            data: messageDraft.value?.trim() ?? '',
          },
        }
  return partialTaskDraft.parse(task)
})

const addNewTask = async (mode: MessageExecutionMode) => {
  const fileIds = await props.client.sendFiles(fileAttachments.value)
  const previousTaskId = props.selectedTaskId
  const { createdTasks } = await createNewTaskChain({
    currentTask: props.currentTask,
    draftTask: currentNewTask.value,
    entryNode: props.entryNode
      ? partialTaskDraft.parse(structuredClone(toRaw(props.entryNode)))
      : undefined,
    fileIds,
    mode,
    priorTaskId: previousTaskId,
  })
  const newTaskId = createdTasks.at(-1)?.id

  props.markTasksPendingCreation?.(createdTasks.map((task) => task.id))
  await props.client.task.createChain({
    tasks: createdTasks,
    execute: true,
    show: true,
  })

  if (!previousTaskId) props.navigateToTask?.(newTaskId)
  emit(
    'created',
    newTaskId,
    createdTasks.map((task) => task.id),
  )

  if (currentNewTask.value.role === 'user') {
    messageDraft.value = ''
    fileAttachments.value = []
  }
}

const attachFileToDraft = (newFiles: File[]) => {
  fileAttachments.value.push(...newFiles)
}

const removeFileFromDraft = (file: File) => {
  const index = fileAttachments.value.indexOf(file)
  if (index >= 0) fileAttachments.value.splice(index, 1)
}
</script>
