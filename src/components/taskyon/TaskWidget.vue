<template>
  <!--Task-->
  <TaskField
    v-if="task.content.type === 'files'"
    :task="task"
    :icon="mdiFileDocument"
    icon-color="info"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    @update:message-debug="onUpdateMessageDebug"
  >
    <div class="row items-center">
      <FileBrowser
        v-if="getFile"
        :file-mappings="fileMappings"
        :expert-mode="state.appConfiguration.expertMode"
        preview
        :preview-size="100"
        :get-file="getFile"
      />
      <q-btn
        v-if="state.appConfiguration.expertMode && fileMappings[0]?.opfs"
        flat
        size="sm"
        :icon="mdiFolder"
        :to="`/fm/${fileMappings[0].opfs}`"
      >
        <q-tooltip> Open File Manager </q-tooltip>
      </q-btn>
    </div>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'return'"
    :task="task"
    :icon="matPause"
    icon-color="info"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    @update:message-debug="onUpdateMessageDebug"
  >
    {{ task.content.data }}
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'functioncall'"
    :task="task"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    short
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header>
      <div
        :class="
          nextTask?.content.type === 'error'
            ? 'text-red'
            : nextTask?.content.type === 'toolresult'
              ? 'text-green'
              : 'text-info'
        "
      >
        <div class="row no-wrap q-gutter-sm items-center">
          <q-spinner-orbit v-if="isWorking" size="2em"></q-spinner-orbit>
          <q-icon :name="matCalculate" size="1.5em"></q-icon>
          <div class="ellipsis">{{ task.content.data.name }}</div>
          <q-btn
            v-if="state.appConfiguration.expertMode"
            flat
            size="sm"
            :icon="matBuild"
            :to="`/tool/${task.content.data.name}`"
          />
        </div>
      </div>
    </template>
    <div class="text-bold">arguments (yaml):</div>
    <div caption>
      <div class="scroll-area">
        {{ dump(task.content.data.arguments) }}
      </div>
    </div>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'toolresult'"
    :task="task"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    short
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header>
      Result: {{ safeYamlDump(task.content.data).split(' ').slice(0, 10).join(' ') }}...
    </template>
    <div caption class="relative-position">
      <div class="scroll-area">
        {{ safeYamlDump(task.content.data) }}
      </div>
    </div>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'structured'"
    class="text-info"
    :task="task"
    :show-meta="showMeta"
    :icon="mdiHeadCog"
    :message-debug="resolvedMessageDebug"
    short
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header> Analyze... </template>
    <p style="white-space: pre-wrap">
      {{ safeYamlDump(task.content.data) }}
    </p>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'tooldefinition'"
    :task="task"
    :icon="mdiTools"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    short
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header> function: {{ task.content.data.name }} </template>
    <p style="white-space: pre-wrap">
      {{ task.content.data }}
    </p>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'message'"
    :task="task"
    :icon="task.role === 'system' ? mdiDesktopTower : undefined"
    icon-color="info"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    :short="short"
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header> {{ task.content.data.split(' ').slice(0, 10).join(' ') }}... </template>
    <template #default="{ showTaskMenu }">
      <tyMarkdown
        v-if="state.taskWidgetState[task.id]?.markdownEnabled != false"
        no-line-numbers
        :src="task.content.data"
        :use-iframe="true"
        @iframe-ready="(el: HTMLIFrameElement) => onIframeMessage(el, task.id)"
        @if-longpress="showTaskMenu(true)"
        @if-click="showTaskMenu(false)"
      />
      <div v-else class="raw-markdown q-mb-md">
        {{ task.content.data }}
      </div>
      <SourcesList :sources="task.content.ann ?? []" />
    </template>
  </TaskField>
  <TaskField
    v-else-if="task.content.type === 'error'"
    :task="task"
    :icon="matWarning"
    icon-color="negative"
    :show-meta="showMeta"
    :message-debug="resolvedMessageDebug"
    short
    @update:message-debug="onUpdateMessageDebug"
  >
    <template #header>
      <div class="row">
        <div class="col text-negative">
          {{ `Error: ${humanizeError(task.content.data).split(' ').slice(0, 10).join(' ')}...` }}
        </div>
        <q-btn
          class="col-auto source-task-btn text-negative"
          flat
          dense
          size="xs"
          :icon="matOpenInNew"
          @click="openSourceTaskDialog"
        >
          <q-tooltip>Inspect source task</q-tooltip>
        </q-btn>
      </div>
    </template>
    <template #default="{ showTaskMenu }">
      <div class="text-negative">
        <tyMarkdown
          :src="humanizeError(task.content.data)"
          no-line-numbers
          use-iframe
          @if-longpress="showTaskMenu(true)"
          @if-click="showTaskMenu(false)"
        />
        <div v-if="sourceTaskId" class="text-caption source-task-hint">
          Debug details are attached to the originating task.
        </div>
      </div>
    </template>
  </TaskField>
  <q-dialog v-model="showSourceTaskDialog" maximized>
    <q-card>
      <q-card-section class="row items-center">
        <div class="text-subtitle2">Source task details</div>
        <q-space />
        <q-btn v-close-popup flat dense size="sm" :icon="matClose" />
      </q-card-section>
      <q-separator />
      <q-card-section class="scroll" style="max-height: calc(100vh - 72px)">
        <TaskWidget
          v-if="sourceTaskForDialog"
          :task="sourceTaskForDialog"
          :short="false"
          show-meta
          :message-debug="!!state.messageDebug[sourceTaskForDialog.id]"
          @update:message-debug="onUpdateSourceTaskMessageDebug"
        />
        <div v-else class="text-caption text-negative">Source task not found.</div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import {
  matBuild,
  matCalculate,
  matClose,
  matOpenInNew,
  matPause,
  matWarning,
} from '@quasar/extras/material-icons'
import {
  mdiDesktopTower,
  mdiFileDocument,
  mdiFolder,
  mdiHeadCog,
  mdiTools,
} from '@quasar/extras/mdi-v6'
import tyMarkdown from '@taskyon/shared/components/tyMarkdown.vue'
import { humanizeError, safeYamlDump, type FileMapping, type TaskNode } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref } from 'vue'
import FileBrowser from './FileBrowser.vue'
import SourcesList from './SourcesList.vue'
import TaskField from './TaskField.vue'

const props = defineProps<{
  task: TaskNode
  nextTask?: TaskNode | undefined
  isWorking?: boolean
  short?: boolean
  showMeta?: boolean
  messageDebug?: boolean | undefined
}>()
const emit = defineEmits<{
  (e: 'update:messageDebug', value: boolean): void
}>()

const tystate = useTaskyonStore()

const state = useAppStateStore()
const { task, nextTask = undefined, isWorking, short, showMeta } = props
const showSourceTaskDialog = ref(false)
const sourceTaskForDialog = ref<TaskNode>()
const resolvedMessageDebug = computed(() => props.messageDebug ?? !!state.messageDebug[task.id])
const sourceTaskId = computed(() =>
  task.content.type === 'error' ? (task.parentID ?? task.priorID) : undefined,
)
const onUpdateMessageDebug = (value: boolean) => {
  if (props.messageDebug !== undefined) {
    emit('update:messageDebug', value)
    return
  }
  state.messageDebug[task.id] = value
}
const onUpdateSourceTaskMessageDebug = (value: boolean) => {
  const sourceId = sourceTaskForDialog.value?.id
  if (!sourceId) return
  state.messageDebug[sourceId] = value
}

async function openSourceTaskDialog() {
  if (!sourceTaskId.value) return
  sourceTaskForDialog.value =
    (await (await tystate.taskyon).getTask(sourceTaskId.value)) ?? undefined
  if (sourceTaskForDialog.value?.id) {
    state.messageDebug[sourceTaskForDialog.value.id] = true
  }
  showSourceTaskDialog.value = true
}

const fileMappings = ref<FileMapping[]>([])
async function getFile(id: string) {
  console.log('load image', id)
  return (await tystate.taskyon).getUploadedFile(id)
}

const onIframeMessage = (el: HTMLIFrameElement, id: string) => {
  void tystate.connectMessageIframe(id, el)
}

if (task.content.type === 'files') {
  console.log('get uploaded files')
  void (async (fileUuids: string[]) => {
    const ty = await tystate.taskyon
    const fm = await Promise.all(fileUuids.map((uuid) => ty.getFileMappingByUuid(uuid)))
    fileMappings.value = fm.filter((x) => x != null)
    /*fileMappings.value = fm.map((x) => {
      const newfm = { ...x, xinfo: { uuid: x?.uuid } };
      return newfm;
    });*/
  })(task.content.data)
}
</script>
