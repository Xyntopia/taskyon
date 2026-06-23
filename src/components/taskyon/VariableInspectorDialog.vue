<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="variable-inspector-dialog">
      <q-card-section class="row items-center">
        <div class="text-subtitle2">Variable inspector</div>
        <q-space />
        <q-btn
          v-if="task"
          flat
          dense
          size="sm"
          :label="viewMode === 'data' ? 'Show task' : 'Show data'"
          @click="toggleViewMode"
        />
        <q-btn v-close-popup flat dense size="sm" :icon="matClose" />
      </q-card-section>
      <q-separator />
      <q-card-section class="scroll" style="max-height: calc(100vh - 72px)">
        <ObjectView
          v-if="viewMode === 'data'"
          :model-value="taskData"
          read-only
          copy-object-btn
          copy-btn
          dense
          missing-mode="hide"
        />
        <AsyncTaskWidget
          v-else-if="task"
          :task="task"
          :short="false"
          show-meta
          :message-debug="false"
          @update:message-debug="ignoreMessageDebugUpdate"
        />
        <div v-else class="text-caption text-negative">Variable task not found.</div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { matClose } from '@quasar/extras/material-icons'
import ObjectView from '@taskyon/shared/components/varViews/ObjectView.vue'
import type { TaskNode } from '@taskyon/taskyon'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

const AsyncTaskWidget = defineAsyncComponent(() => import('./TaskWidget.vue'))

const props = defineProps<{
  modelValue: boolean
  task?: TaskNode | undefined
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const viewMode = ref<'data' | 'task'>('data')
const taskData = computed(() => {
  const data = props.task?.content.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined
})

const toggleViewMode = () => {
  viewMode.value = viewMode.value === 'data' ? 'task' : 'data'
}

const ignoreMessageDebugUpdate = () => undefined

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) viewMode.value = 'data'
  },
)
</script>

<style scoped>
.variable-inspector-dialog {
  width: min(1200px, calc(100vw - 4rem));
  max-width: calc(100vw - 4rem);
  max-height: calc(100vh - 4rem);
}
</style>
