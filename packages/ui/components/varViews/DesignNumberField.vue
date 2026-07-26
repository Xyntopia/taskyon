<template>
  <div class="design-number-field">
    <div class="design-number-inputs" :class="{ 'design-number-inputs--input-only': !hasRange }">
      <q-slider
        v-if="hasRange"
        :model-value="numberValue"
        :min="minimum"
        :max="maximum"
        :step="step"
        label
        color="secondary"
        :disable="readOnly"
        @update:model-value="emitSlider"
      />
      <q-input
        :model-value="numberValue"
        type="number"
        dense
        outlined
        :readonly="readOnly"
        :min="minimum"
        :max="maximum"
        :step="step"
        @update:model-value="emitNumber"
      />
    </div>
    <div v-if="optimizationMode && optimizable" class="optimization-settings">
      <q-checkbox
        :model-value="optimizationEnabled"
        dense
        color="secondary"
        label="Optimize"
        @update:model-value="(enabled) => emit('update-optimization-enabled', enabled)"
      />
      <q-select
        v-if="optimizationEnabled"
        :model-value="allowedOptimizers"
        :options="optimizerOptions"
        dense
        outlined
        multiple
        use-chips
        emit-value
        map-options
        label="Allowed optimizers"
        @update:model-value="(optimizers) => emit('update-allowed-optimizers', optimizers)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VariableNode } from './useVariableGraph'
import { computed } from 'vue'

const props = defineProps<{
  node: VariableNode
  value: unknown
  readOnly?: boolean
  optimizationMode?: boolean
  optimizable?: boolean
  optimizationEnabled?: boolean
  allowedOptimizers?: string[]
  optimizerOptions?: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  (event: 'update', value: number): void
  (event: 'update-optimization-enabled', value: boolean): void
  (event: 'update-allowed-optimizers', value: string[]): void
}>()
const numberValue = computed(() => (typeof props.value === 'number' ? props.value : 0))
const minimum = computed(() =>
  typeof props.node.schema?.minimum === 'number' ? props.node.schema.minimum : undefined,
)
const maximum = computed(() =>
  typeof props.node.schema?.maximum === 'number' ? props.node.schema.maximum : undefined,
)
const hasRange = computed(
  () =>
    minimum.value !== undefined &&
    Number.isFinite(minimum.value) &&
    maximum.value !== undefined &&
    Number.isFinite(maximum.value),
)
const step = computed(() => {
  const value = props.node.schema?.multipleOf
  return typeof value === 'number' && value > 0 ? value : 1
})
const emitNumber = (value: string | number | null) => {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) emit('update', parsed)
}
const emitSlider = (value: number | null) => {
  if (value !== null) emit('update', value)
}
</script>

<style scoped>
.design-number-field {
  display: grid;
  gap: 0.35rem;
  width: 100%;
}

.design-number-inputs {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) 6.5rem;
  gap: 0.75rem;
  align-items: center;
}

.design-number-inputs--input-only {
  grid-template-columns: minmax(8rem, 1fr);
}

.optimization-settings {
  display: grid;
  grid-template-columns: auto minmax(10rem, 1fr);
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border-left: 2px solid var(--q-secondary);
  background: color-mix(in srgb, var(--q-secondary) 7%, transparent);
}
</style>
