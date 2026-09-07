<template>
  <section class="task-execution-progress" data-cy="taskyon-live-progress" aria-live="polite">
    <pre v-if="progress.toolProgress" class="text-caption task-execution-progress__tool-progress">{{
      progress.toolProgress
    }}</pre>

    <template v-if="progress.reasoning">
      <div class="text-caption">THINKING:</div>
      <div
        ref="reasoningContainer"
        class="task-execution-progress__reasoning"
        @scroll="updateAutoScroll"
      >
        <TyMarkdown :src="progress.reasoning" class="text-caption" no-line-numbers no-mermaid />
      </div>
    </template>

    <q-card class="row" flat>
      <div class="col">
        <TyMarkdown v-if="progress.text" :src="progress.text" no-line-numbers no-mermaid />
        <div v-if="progress.toolInput">{{ progress.toolInput }}</div>
        <q-spinner-dots size="2rem" color="secondary" />
      </div>
    </q-card>
  </section>
</template>

<script setup lang="ts">
import type { TaskExecutionProgress } from '@taskyon/ui/modules/taskExecutionProgress'
import { nextTick, ref, watch } from 'vue'
import TyMarkdown from '../tyMarkdown.vue'

const { progress } = defineProps<{
  progress: TaskExecutionProgress
}>()

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
  width: 100%

.task-execution-progress__reasoning
  max-height: 300px
  overflow-y: auto
  font-size: 0.8rem

.task-execution-progress__tool-progress
  max-height: 8rem
  margin: 0 0 0.5rem
  overflow: auto
  white-space: pre-wrap
  overflow-wrap: anywhere
</style>
