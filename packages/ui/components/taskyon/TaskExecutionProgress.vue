<template>
  <section class="task-execution-progress" data-cy="taskyon-live-progress" aria-live="polite">
    <header class="task-execution-progress__header">
      <q-spinner-dots color="primary" size="1.25rem" />
      <strong>{{ activityLabel }}</strong>
      <span v-if="progress.message" class="task-execution-progress__status">
        {{ progress.message }}
      </span>
    </header>

    <q-expansion-item
      v-if="progress.streaming"
      class="task-execution-progress__thinking"
      dense
      default-opened
      expand-separator
      header-class="task-execution-progress__thinking-header"
    >
      <template #header>
        <q-item-section avatar>
          <q-icon :name="mdiThoughtBubbleOutline" size="1rem" />
        </q-item-section>
        <q-item-section>
          <q-item-label>Thinking</q-item-label>
        </q-item-section>
      </template>
      <div
        v-if="progress.reasoning"
        ref="reasoningContainer"
        class="task-execution-progress__reasoning"
        @scroll="updateAutoScroll"
      >
        <TyMarkdown :src="progress.reasoning" no-line-numbers no-mermaid />
      </div>
      <div v-else class="task-execution-progress__placeholder">Waiting for provider reasoning…</div>
    </q-expansion-item>

    <pre v-if="progress.toolProgress" class="task-execution-progress__tool-status">{{
      progress.toolProgress
    }}</pre>

    <div v-if="progress.text" class="task-execution-progress__answer">
      <div class="task-execution-progress__label">Answer</div>
      <TyMarkdown :src="progress.text" no-line-numbers no-mermaid />
    </div>

    <div v-if="progress.toolName || progress.toolInput" class="task-execution-progress__tool">
      <div class="task-execution-progress__label">Calling {{ progress.toolName || 'a tool' }}</div>
      <pre v-if="progress.toolInput">{{ progress.toolInput }}</pre>
    </div>
  </section>
</template>

<script setup lang="ts">
import { mdiThoughtBubbleOutline } from '@quasar/extras/mdi-v6'
import type { TaskExecutionProgress } from '@taskyon/ui/modules/taskExecutionProgress'
import { computed, nextTick, ref, watch } from 'vue'
import TyMarkdown from '../tyMarkdown.vue'

const { progress } = defineProps<{
  progress: TaskExecutionProgress
}>()

const activityLabel = computed(() =>
  progress.streaming
    ? 'Calling the model'
    : progress.stage === 'tool progress'
      ? 'Running tool'
      : 'Working',
)

const reasoningContainer = ref<HTMLElement>()
const shouldAutoScroll = ref(true)

const updateAutoScroll = () => {
  const container = reasoningContainer.value
  if (!container) return
  shouldAutoScroll.value = container.scrollHeight - container.scrollTop - container.clientHeight < 8
}

watch(
  () => progress.reasoning,
  async () => {
    if (!shouldAutoScroll.value) return
    await nextTick()
    const container = reasoningContainer.value
    if (container) container.scrollTop = container.scrollHeight
  },
)
</script>

<style scoped lang="sass">
.task-execution-progress
  width: min(100%, 48rem)
  padding: 0.8rem 0.95rem
  border: 1px solid color-mix(in srgb, var(--q-primary) 28%, var(--divider-color, transparent))
  border-radius: 0.8rem
  background: color-mix(in srgb, var(--q-primary) 5%, var(--card-background-color, transparent))

.task-execution-progress__header
  display: flex
  align-items: center
  gap: 0.45rem
  min-width: 0
  color: var(--primary-text-color, inherit)

.task-execution-progress__status
  min-width: 0
  overflow: hidden
  color: var(--secondary-text-color, currentColor)
  text-overflow: ellipsis
  white-space: nowrap

.task-execution-progress__thinking
  margin-top: 0.5rem
  border-top: 1px solid var(--divider-color, currentColor)

.task-execution-progress__thinking-header
  min-height: 2rem
  padding: 0.25rem 0
  color: var(--secondary-text-color, currentColor)

.task-execution-progress__reasoning
  max-height: 18rem
  overflow-y: auto
  padding: 0.45rem 0 0.2rem 2.1rem
  color: var(--secondary-text-color, currentColor)
  font-size: 0.85rem

.task-execution-progress__tool-status
  max-height: 10rem
  margin: 0.5rem 0 0
  overflow: auto
  white-space: pre-wrap
  overflow-wrap: anywhere
  color: var(--secondary-text-color, currentColor)
  font-size: 0.8rem

.task-execution-progress__placeholder
  padding: 0.45rem 0 0.2rem 2.1rem
  color: var(--secondary-text-color, currentColor)
  font-size: 0.85rem

.task-execution-progress__answer,
.task-execution-progress__tool
  margin-top: 0.6rem

.task-execution-progress__label
  margin-bottom: 0.2rem
  color: var(--secondary-text-color, currentColor)
  font-size: 0.75rem
  font-weight: 700
  letter-spacing: 0.04em
  text-transform: uppercase

.task-execution-progress__tool pre
  max-height: 10rem
  margin: 0
  overflow: auto
  white-space: pre-wrap
  overflow-wrap: anywhere
  color: var(--secondary-text-color, currentColor)
  font-size: 0.8rem
</style>
