<template>
  <div class="column q-gutter-sm">
    <div v-for="node in nodes" :key="node.id">
      <VariableField
        :node="node"
        :read-only="readOnly"
        :separate-labels="separateLabels"
        :copy-btn="copyBtn"
        :input-field-behavior="inputFieldBehavior"
        :debounce="debounce"
        :list-summary="listSummary"
        :chart-paths="chartPaths"
        :full-view-paths="fullViewPaths"
        :renderers="renderers"
        :show-label="true"
        @update="(value) => emitUpdate(node, value)"
        @reset="() => emitReset(node)"
        @copy="() => emitCopy(node.path)"
        @toggle-chart="(id) => emitToggleChart(id)"
        @toggle-full-view="(payload) => emitToggleFullView(payload)"
      >
        <template #header-extra="slotProps">
          <slot name="header-extra" v-bind="slotProps" />
        </template>
        <template #custom="slotProps">
          <slot name="custom" v-bind="slotProps" />
        </template>
      </VariableField>
    </div>
  </div>
</template>

<script setup lang="ts">
import VariableField from './VariableField.vue'
import type { VariableNode } from './useVariableGraph'
import type { CustomRenderer } from './VariableField.vue'

const props = defineProps<{
  nodes: VariableNode[]
  readOnly?: boolean
  separateLabels?: boolean
  debounce?: number
  copyBtn?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  listSummary?: number
  chartPaths?: string[]
  fullViewPaths?: string[]
  renderers?: CustomRenderer[]
}>()

const emit = defineEmits<{
  (e: 'update', payload: { path: string[]; value: unknown }): void
  (e: 'reset', node: VariableNode): void
  (e: 'copy', path: string[]): void
  (e: 'toggle-chart', id: string): void
  (e: 'toggle-full-view', payload: { id: string; value: unknown }): void
}>()

const readOnly = props.readOnly ?? false
const separateLabels = props.separateLabels ?? true
const debounce = props.debounce ?? 100
const copyBtn = props.copyBtn ?? false
const inputFieldBehavior = props.inputFieldBehavior ?? 'auto'
const listSummary = props.listSummary ?? 10
const chartPaths = props.chartPaths ?? []
const fullViewPaths = props.fullViewPaths ?? []
const renderers = props.renderers ?? []

const emitUpdate = (node: VariableNode, value: unknown) => {
  emit('update', { path: node.path, value })
}

const emitReset = (node: VariableNode) => {
  emit('reset', node)
}

const emitCopy = (path: string[]) => {
  emit('copy', path)
}

const emitToggleChart = (id: string) => {
  emit('toggle-chart', id)
}

const emitToggleFullView = (payload: { id: string; value: unknown }) => {
  emit('toggle-full-view', payload)
}
</script>
