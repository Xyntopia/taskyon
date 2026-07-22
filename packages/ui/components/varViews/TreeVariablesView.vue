<!-- TreeVariablesView.vue -->
<template>
  <q-tree
    v-model:expanded="expandedKeys"
    :nodes="treeNodes"
    node-key="key"
    class="object-tree-view"
    @lazy-load="onLazyLoad"
  >
    <template #default-header></template>

    <template #header-object="prop">
      <VariableField
        :node="prop.node.varNode"
        :read-only="readOnly"
        :separate-labels="true"
        :copy-btn="copyBtn"
        :input-field-behavior="inputFieldBehavior"
        :debounce="debounce"
        :list-summary="listSummary"
        :chart-paths="chartPaths"
        :full-view-paths="fullViewPaths"
        :renderers="renderers"
        :show-label="true"
        :show-missing-indicator="showMissingIndicator"
        :schema-documentation="schemaDocumentation"
        @update="(value) => emitUpdate(prop.node.varNode, value)"
        @reset="() => emitReset(prop.node.varNode)"
        @copy="() => emitCopy(prop.node.varNode.path)"
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
    </template>

    <template #body-field="prop">
      <VariableField
        :node="prop.node.varNode"
        :read-only="readOnly"
        :separate-labels="separateLabels"
        :copy-btn="copyBtn"
        :input-field-behavior="inputFieldBehavior"
        :debounce="debounce"
        :list-summary="listSummary"
        :chart-paths="chartPaths"
        :full-view-paths="fullViewPaths"
        :renderers="renderers"
        :show-label="separateLabels"
        :show-missing-indicator="showMissingIndicator"
        :schema-documentation="schemaDocumentation"
        @update="(value) => emitUpdate(prop.node.varNode, value)"
        @reset="() => emitReset(prop.node.varNode)"
        @copy="() => emitCopy(prop.node.varNode.path)"
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
    </template>
  </q-tree>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { type QTreeNode } from 'quasar'
import type { JSONSchema7 } from 'json-schema'
import type z from 'zod'

import VariableField from './VariableField.vue'
import type { VariableNode } from './useVariableGraph'
import type { CustomRenderer } from './VariableField.vue'

const props = defineProps<{
  nodes: VariableNode[]
  loadChildren: (
    path: string[],
    schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
  ) => VariableNode[]
  readOnly?: boolean
  separateLabels?: boolean
  debounce?: number
  copyBtn?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  listSummary?: number
  chartPaths?: string[]
  fullViewPaths?: string[]
  renderers?: CustomRenderer[]
  showMissingIndicator?: boolean
  defaultExpandedDepth?: number
  schemaDocumentation?: boolean
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
const chartPaths = computed(() => props.chartPaths ?? [])
const fullViewPaths = computed(() => props.fullViewPaths ?? [])
const renderers = props.renderers ?? []
const showMissingIndicator = props.showMissingIndicator ?? true
const schemaDocumentation = props.schemaDocumentation ?? false

const isContainerNode = (node: VariableNode) =>
  node.kind === 'object' || (node.kind === 'array' && node.children !== undefined)

const expandedNodeKeys = (nodes: VariableNode[], depth: number): string[] =>
  depth <= 0
    ? []
    : nodes.flatMap((node) => [
        ...(isContainerNode(node) ? [node.id] : []),
        ...expandedNodeKeys(node.children ?? [], depth - 1),
      ])

const expandedKeys = ref<string[]>([])
let initialExpansionApplied = false
watch(
  () => props.nodes,
  (nodes) => {
    if (initialExpansionApplied || nodes.length === 0) return
    expandedKeys.value = expandedNodeKeys(nodes, props.defaultExpandedDepth ?? 0)
    initialExpansionApplied = true
  },
  { immediate: true },
)

const toQTreeNode = (node: VariableNode): QTreeNode => ({
  key: node.id,
  label: node.label,
  ...(node.icon ? { icon: node.icon } : {}),
  children: node.children?.map(toQTreeNode) ?? [],
  ...(node.lazy ? { lazy: true } : {}),
  ...(isContainerNode(node) ? { header: 'object' } : { body: 'field' }),
  varNode: node,
})

const treeNodes = computed(() => props.nodes.map(toQTreeNode))

type LazyLoadParams = {
  node: QTreeNode & { varNode: VariableNode }
  done: (children: QTreeNode[]) => void
  fail: () => void
}

const onLazyLoad = ({ node, done, fail }: LazyLoadParams) => {
  try {
    const varNode = node.varNode
    const children = props.loadChildren(varNode.path, varNode.schema)
    done(children.map(toQTreeNode))
  } catch (err) {
    console.error('Lazy load failed', err)
    fail()
  }
}

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

<style scoped lang="sass">
.q-tree--dense .q-tree__node--child
    padding-left: 0
</style>
