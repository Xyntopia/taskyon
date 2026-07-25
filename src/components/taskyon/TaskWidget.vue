<template>
  <div class="task-container">
    <!--Task-->
    <TaskField
      v-if="task.content.type === 'files'"
      :task="task"
      :icon="mdiFileDocument"
      icon-color="info"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
      @update:message-debug="onUpdateMessageDebug"
    >
      <div class="row items-center">
        <TaskContentView
          :task="task"
          :file-mappings="fileMappings"
          :expert-mode="state.appConfiguration.expertMode"
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
      :raw-conversation-text="rawConversationText"
      @update:message-debug="onUpdateMessageDebug"
    >
      <TaskContentView :task="task" />
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'functioncall'"
      :task="task"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
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
            <span v-if="isWorking" class="task-working-indicator">
              <q-spinner-orbit size="2em" />
              <q-tooltip> Tool or child tasks still running </q-tooltip>
            </span>
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
      <TaskContentView
        :task="task"
        show-variable-actions
        @open-variable="openVariableInspectorDialog"
      />
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'toolresult'"
      :task="task"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
      short
      @update:message-debug="onUpdateMessageDebug"
    >
      <template #header>
        Result: {{ summarizeTaskData(task.content.data).split(' ').slice(0, 10).join(' ') }}...
      </template>
      <TaskContentView :task="task" />
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'structured'"
      class="text-info"
      :task="task"
      :show-meta="showMeta"
      :icon="mdiHeadCog"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
      short
      @update:message-debug="onUpdateMessageDebug"
    >
      <template #header> Analyze... </template>
      <TaskContentView :task="task" />
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'tooldefinition'"
      :task="task"
      :icon="mdiTools"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
      short
      @update:message-debug="onUpdateMessageDebug"
    >
      <template #header> function: {{ task.content.data.name }} </template>
      <TaskContentView :task="task" />
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'message'"
      :task="task"
      :icon="task.role === 'system' ? mdiDesktopTower : undefined"
      icon-color="info"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
      :short="short"
      @update:message-debug="onUpdateMessageDebug"
    >
      <template #header> {{ task.content.data.split(' ').slice(0, 10).join(' ') }}... </template>
      <template #default="{ showTaskMenu }">
        <TaskContentView
          :task="task"
          :markdown-enabled="state.taskWidgetState[task.id]?.markdownEnabled != false"
          use-markdown-iframe
          @iframe-ready="(el: HTMLIFrameElement) => onIframeMessage(el, task.id)"
          @if-longpress="showTaskMenu(true)"
          @if-click="showTaskMenu(false)"
        />
      </template>
    </TaskField>
    <TaskField
      v-else-if="task.content.type === 'error'"
      :task="task"
      :icon="matWarning"
      icon-color="negative"
      :show-meta="showMeta"
      :message-debug="resolvedMessageDebug"
      :raw-conversation-text="rawConversationText"
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
        <TaskContentView
          :task="task"
          use-markdown-iframe
          :show-source-task-hint="sourceTaskId !== undefined"
          @if-longpress="showTaskMenu(true)"
          @if-click="showTaskMenu(false)"
        />
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
            :message-debug="sourceTaskMessageDebug"
            @update:message-debug="onUpdateSourceTaskMessageDebug"
          />
          <div v-else class="text-caption text-negative">Source task not found.</div>
        </q-card-section>
      </q-card>
    </q-dialog>
    <VariableInspectorDialog v-model="showVariableInspectorDialog" :task="variableTaskForDialog" />
  </div>
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
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import TaskContentView from '@taskyon/ui/components/taskyon/TaskContentView.vue'
import { humanizeError, type FileMapping, type TaskNode } from '@taskyon/taskyon'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref, toRefs } from 'vue'
import TaskField from './TaskField.vue'
import {
  formatRawConversationDebug,
  getRawConversationDebug,
  hasRawConversationDebug,
} from './taskDebugConversation'
import VariableInspectorDialog from './VariableInspectorDialog.vue'

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
const { task, nextTask, isWorking, short, showMeta } = toRefs(props)
const showSourceTaskDialog = ref(false)
const showVariableInspectorDialog = ref(false)
const sourceTaskForDialog = ref<TaskNode>()
const variableTaskForDialog = ref<TaskNode>()
const sourceTaskMessageDebug = ref(false)
const resolvedMessageDebug = computed(() => props.messageDebug ?? false)
const sourceTaskId = computed(() =>
  task.value.content.type === 'error' ? (task.value.parentID ?? task.value.priorID) : undefined,
)
const loadTaskById = async (taskId: string) =>
  (await tystate.taskyonClient.task.get({ id: taskId })) ?? undefined
const taskMeta = tystate.getTaskMetaRef(task.value.id)
const rawConversationText = computed(() => {
  const debug = getRawConversationDebug(taskMeta.value)
  return hasRawConversationDebug(debug) ? formatRawConversationDebug(debug) : undefined
})
const summarizeTaskData = (value: unknown) =>
  serializeObject(value, {
    maxDepth: 4,
    maxArrayLength: 20,
    maxObjectKeys: 20,
    maxStringLength: 2000,
    format: 'yaml',
  })
const onUpdateMessageDebug = (value: boolean) => {
  emit('update:messageDebug', value)
}
const onUpdateSourceTaskMessageDebug = (value: boolean) => {
  sourceTaskMessageDebug.value = value
}

async function openSourceTaskDialog() {
  if (!sourceTaskId.value) return
  sourceTaskForDialog.value = await loadTaskById(sourceTaskId.value)
  sourceTaskMessageDebug.value = false
  showSourceTaskDialog.value = true
}

async function openVariableInspectorDialog(taskId: string) {
  variableTaskForDialog.value = await loadTaskById(taskId)
  showVariableInspectorDialog.value = true
}

const fileMappings = ref<FileMapping[]>([])
async function getFile(id: string) {
  console.log('load image', id)
  return (await tystate.taskyon).getUploadedFile(id)
}

const onIframeMessage = (el: HTMLIFrameElement, id: string) => {
  void tystate.connectMessageIframe(id, el)
}

if (task.value.content.type === 'files') {
  console.log('get uploaded files')
  void (async (fileUuids: string[]) => {
    const ty = await tystate.taskyon
    const fm = await Promise.all(fileUuids.map((uuid) => ty.getFileMappingByUuid(uuid)))
    fileMappings.value = fm.filter((x) => x != null)
    /*fileMappings.value = fm.map((x) => {
      const newfm = { ...x, xinfo: { uuid: x?.uuid } };
      return newfm;
    });*/
  })(task.value.content.data)
}
</script>
