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
      :raw-conversation-text="rawConversationText"
      @update:message-debug="onUpdateMessageDebug"
    >
      {{ task.content.data }}
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
      <div class="text-bold">arguments (yaml):</div>
      <div caption>
        <pre class="scroll-area task-arguments-yaml"><template
          v-for="(segment, index) in functionArgumentSegments"
          :key="`${segment.type}-${index}`"
          ><span v-if="segment.type === 'text'">{{ segment.value }}</span
          ><span v-else class="task-variable-ref"
            >{{ segment.value
            }}<TaskVariableHint :task-id="segment.taskId" @open-variable="openVariableInspectorDialog" /></span
          ></template
        ></pre>
      </div>
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
      <div caption class="relative-position">
        <div class="scroll-area">
          {{ summarizeTaskData(task.content.data) }}
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
      :raw-conversation-text="rawConversationText"
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
      :raw-conversation-text="rawConversationText"
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
      :raw-conversation-text="rawConversationText"
      :short="short"
      @update:message-debug="onUpdateMessageDebug"
    >
      <template #header> {{ task.content.data.split(' ').slice(0, 10).join(' ') }}... </template>
      <template #default="{ showTaskMenu }">
        <tyMarkdown
          v-if="state.taskWidgetState[task.id]?.markdownEnabled != false"
          no-line-numbers
          :src="resolvedMessageContent"
          :use-iframe="true"
          :extensions="taskMarkdownExtensions"
          @iframe-ready="(el: HTMLIFrameElement) => onIframeMessage(el, task.id)"
          @if-longpress="showTaskMenu(true)"
          @if-click="showTaskMenu(false)"
          @inline-action="onInlineMarkdownAction"
        />
        <div v-else class="raw-markdown q-mb-md">
          {{ resolvedMessageContent }}
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
import tyMarkdown from '@taskyon/shared/components/tyMarkdown.vue'
import { serializeObject } from '@taskyon/shared/modules/serializeObject'
import {
  humanizeError,
  safeYamlDump,
  taskRefToTaskId,
  type FileMapping,
  type TaskNode,
} from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import { createTaskMarkdownExtension } from 'src/modules/taskyon/taskMarkdownExtension'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref, toRefs } from 'vue'
import FileBrowser from './FileBrowser.vue'
import SourcesList from './SourcesList.vue'
import TaskField from './TaskField.vue'
import {
  formatRawConversationDebug,
  getRawConversationDebug,
  hasRawConversationDebug,
} from './taskDebugConversation'
import TaskVariableHint from './TaskVariableHint.vue'
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
  (await (await tystate.taskyon).getTask(taskId)) ?? undefined
const taskMeta = tystate.getTaskMetaRef(task.value.id)
const resolvedMessageContent = ref(
  task.value.content.type === 'message' ? task.value.content.data : '',
)
const taskMarkdownExtensions = computed(() => [createTaskMarkdownExtension(loadTaskById)])
const functionArgumentsYaml = computed(() =>
  task.value.content.type === 'functioncall' ? dump(task.value.content.data.arguments) : '',
)
const functionArgumentSegments = computed(() => {
  const input = functionArgumentsYaml.value
  const regex = /_t:[A-Za-z0-9_-]+/g
  const segments: Array<
    { type: 'text'; value: string } | { type: 'variable'; value: string; taskId: string }
  > = []
  let lastIndex = 0

  for (const match of input.matchAll(regex)) {
    const value = match[0]
    const start = match.index ?? 0
    const taskId = taskRefToTaskId(value)
    if (start > lastIndex) {
      segments.push({ type: 'text', value: input.slice(lastIndex, start) })
    }
    if (taskId) segments.push({ type: 'variable', value, taskId })
    else segments.push({ type: 'text', value })
    lastIndex = start + value.length
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', value: input.slice(lastIndex) })
  }

  return segments
})
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

function onInlineMarkdownAction(event: { action: string; payload: unknown }) {
  const payload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as { taskId?: string })
      : undefined
  const taskId = payload?.taskId
  if (!taskId) return

  if (event.action === 'taskyon-variable-open') {
    void openVariableInspectorDialog(taskId)
  }
}

const fileMappings = ref<FileMapping[]>([])
async function getFile(id: string) {
  console.log('load image', id)
  return (await tystate.taskyon).getUploadedFile(id)
}

const onIframeMessage = (el: HTMLIFrameElement, id: string) => {
  void tystate.connectMessageIframe(id, el)
}

const resolveTaskWidgetVariables = () => {
  if (task.value.content.type === 'message') {
    resolvedMessageContent.value = task.value.content.data
  }
}

void resolveTaskWidgetVariables()

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

<style scoped>
.task-arguments-yaml {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.task-variable-ref {
  color: var(--q-secondary);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}
</style>
