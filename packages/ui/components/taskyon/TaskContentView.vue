<template>
  <div :class="['task-content-view', `task-content-view--${task.content.type}`]">
    <template v-if="task.content.type === 'message'">
      <TyMarkdown
        v-if="markdownEnabled"
        no-line-numbers
        :src="task.content.data"
        :use-iframe="useMarkdownIframe"
        @iframe-ready="emit('iframe-ready', $event)"
        @if-longpress="emit('if-longpress', $event)"
        @if-click="emit('if-click', $event)"
      />
      <div v-else class="task-content-view__raw">{{ task.content.data }}</div>
      <TaskSourcesList :sources="task.content.ann ?? []" />
    </template>

    <template v-else-if="task.content.type === 'functioncall'">
      <div class="task-content-view__label text-caption text-weight-bold">Arguments</div>
      <pre class="task-content-view__code"><template
        v-for="(segment, index) in functionArgumentSegments"
        :key="`${segment.type}-${index}`"
        ><span v-if="segment.type === 'text'">{{ segment.value }}</span
        ><span v-else class="task-content-view__variable"
          >{{ segment.value
          }}<TaskVariableHint
            v-if="showVariableActions"
            :task-id="segment.taskId"
            @open-variable="emit('open-variable', $event)"
          /></span
      ></template></pre>
    </template>

    <template v-else-if="task.content.type === 'files'">
      <TaskFileBrowser
        v-if="fileMappings.length > 0 && getFile"
        :file-mappings="fileMappings"
        :expert-mode="expertMode"
        preview
        :preview-size="100"
        :get-file="getFile"
      />
      <q-list v-else dense>
        <q-item v-for="fileId in task.content.data" :key="fileId">
          <q-item-section>{{ fileId }}</q-item-section>
        </q-item>
      </q-list>
    </template>

    <TyMarkdown
      v-else-if="task.content.type === 'error'"
      class="text-negative"
      no-line-numbers
      :src="humanizeError(task.content.data)"
      :use-iframe="useMarkdownIframe"
      @if-longpress="emit('if-longpress', $event)"
      @if-click="emit('if-click', $event)"
    />

    <div v-else-if="task.content.type === 'return'" class="task-content-view__text">
      {{ task.content.data }}
    </div>

    <pre v-else class="task-content-view__code">{{ formattedContent }}</pre>

    <div
      v-if="task.content.type === 'error' && showSourceTaskHint"
      class="task-content-view__hint text-caption"
    >
      Debug details are attached to the originating task.
    </div>
  </div>
</template>

<script setup lang="ts">
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { humanizeError } from '@taskyon/common/modules/utils/error'
import { safeYamlDump } from '@taskyon/common/modules/yamlUtils'
import { taskRefToTaskId, type FileMapping, type TaskNode } from '@taskyon/taskyon'
import { computed } from 'vue'
import TaskFileBrowser from './TaskFileBrowser.vue'
import TaskSourcesList from './TaskSourcesList.vue'
import TaskVariableHint from './TaskVariableHint.vue'
import TyMarkdown from '../tyMarkdown.vue'

const props = withDefaults(
  defineProps<{
    task: TaskNode
    fileMappings?: readonly FileMapping[]
    getFile?: ((uuid: string) => Promise<File | undefined>) | undefined
    expertMode?: boolean
    markdownEnabled?: boolean
    useMarkdownIframe?: boolean
    showSourceTaskHint?: boolean
    showVariableActions?: boolean
  }>(),
  {
    fileMappings: () => [],
    getFile: undefined,
    expertMode: false,
    markdownEnabled: true,
    useMarkdownIframe: false,
    showSourceTaskHint: false,
    showVariableActions: false,
  },
)

const emit = defineEmits<{
  (event: 'iframe-ready', element: HTMLIFrameElement): void
  (event: 'if-longpress', position: { x: number; y: number }): void
  (event: 'if-click', position: { x: number; y: number }): void
  (event: 'open-variable', taskId: string): void
}>()

const functionArgumentSegments = computed(() => {
  if (props.task.content.type !== 'functioncall') return []

  const input = safeYamlDump(props.task.content.data.arguments)
  const segments: Array<
    { type: 'text'; value: string } | { type: 'variable'; value: string; taskId: string }
  > = []
  let lastIndex = 0

  for (const match of input.matchAll(/_t:[A-Za-z0-9_-]+/g)) {
    const value = match[0]
    const start = match.index
    const taskId = taskRefToTaskId(value)
    if (start > lastIndex) segments.push({ type: 'text', value: input.slice(lastIndex, start) })
    if (taskId) segments.push({ type: 'variable', value, taskId })
    else segments.push({ type: 'text', value })
    lastIndex = start + value.length
  }

  if (lastIndex < input.length) segments.push({ type: 'text', value: input.slice(lastIndex) })
  return segments
})

const formattedContent = computed(() =>
  props.task.content.type === 'toolresult'
    ? serializeObject(props.task.content.data, {
        maxDepth: 4,
        maxArrayLength: 20,
        maxObjectKeys: 20,
        maxStringLength: 2000,
        format: 'yaml',
      })
    : safeYamlDump(props.task.content.data),
)
</script>

<style scoped lang="sass">
.task-content-view
  min-width: 0

.task-content-view__raw,
.task-content-view__text,
.task-content-view__code
  white-space: pre-wrap
  overflow-wrap: anywhere

.task-content-view__code
  max-width: 100%
  margin: 0
  overflow-x: auto

.task-content-view__label
  margin-bottom: 0.25rem

.task-content-view__variable
  display: inline

.task-content-view__hint
  margin-top: 0.5rem
</style>
