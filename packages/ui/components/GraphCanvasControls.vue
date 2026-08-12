<template>
  <div class="graph-canvas-controls row items-center no-wrap q-gutter-xs">
    <q-btn-toggle
      v-if="showLayout"
      :model-value="layout"
      dense
      no-caps
      flat
      text-color="grey-7"
      :options="layoutOptions"
      aria-label="Graph layout"
      @update:model-value="emit('update:layout', $event)"
    />
    <q-separator v-if="showLayout" vertical />
    <q-btn dense flat no-caps color="grey-7" :disable="nodeOptions.length === 0">
      {{ `Nodes ${visibleNodeIds.length}/${nodeOptions.length}` }}
      <q-menu>
        <q-list dense class="graph-canvas-controls__node-list">
          <q-item>
            <q-item-section>
              <div class="row items-center q-gutter-xs">
                <q-btn dense flat no-caps label="All" @click="showAllNodes" />
                <q-btn dense flat no-caps label="None" @click="emit('update:visibleNodeIds', [])" />
              </div>
            </q-item-section>
          </q-item>
          <q-separator />
          <q-item v-for="node in nodeOptions" :key="node.id" tag="label" clickable>
            <q-item-section side>
              <q-checkbox
                :model-value="visibleNodeIds.includes(node.id)"
                @update:model-value="setNodeVisible(node.id, $event)"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ node.label }}</q-item-label>
              <q-item-label caption>{{ node.id }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-menu>
      <q-tooltip>Choose which nodes are visible</q-tooltip>
    </q-btn>
    <q-toggle
      :model-value="panZoomEnabled"
      dense
      label="Pan/zoom"
      @update:model-value="emit('update:panZoomEnabled', $event)"
    />
    <q-toggle
      :model-value="nodeDragEnabled"
      dense
      label="Drag nodes"
      @update:model-value="emit('update:nodeDragEnabled', $event)"
    />
    <q-btn
      dense
      flat
      no-caps
      color="grey-7"
      label="Fit visible"
      :disable="!hasNodes"
      @click="emit('fit')"
    />
    <q-btn
      dense
      flat
      no-caps
      color="grey-7"
      label="Focus selected"
      :disable="!canFocusSelected"
      @click="emit('focusSelected')"
    />
    <slot />
    <q-space />
    <q-btn
      dense
      flat
      no-caps
      color="grey-7"
      label="Copy PNG"
      :loading="copying"
      :disable="!hasNodes"
      @click="emit('copyPng')"
    />
    <q-btn
      dense
      flat
      no-caps
      color="grey-7"
      label="Export SVG"
      :disable="!hasNodes"
      @click="emit('exportSvg')"
    />
  </div>
</template>

<script setup lang="ts">
import type { GraphViewLayout } from '@taskyon/common/modules/graph'
import { computed } from 'vue'

defineSlots<{ default: () => unknown }>()

const props = withDefaults(
  defineProps<{
    layout?: GraphViewLayout
    showLayout?: boolean
    nodeOptions: Array<{ id: string; label: string }>
    visibleNodeIds: string[]
    selectedNodeId?: string
    panZoomEnabled: boolean
    nodeDragEnabled: boolean
    copying?: boolean
  }>(),
  {
    layout: 'flow',
    showLayout: true,
    copying: false,
  },
)

const emit = defineEmits<{
  'update:layout': [layout: GraphViewLayout]
  'update:visibleNodeIds': [nodeIds: string[]]
  'update:panZoomEnabled': [enabled: boolean]
  'update:nodeDragEnabled': [enabled: boolean]
  fit: []
  focusSelected: []
  copyPng: []
  exportSvg: []
}>()

const layoutOptions = [
  { label: 'Flow', value: 'flow' },
  { label: 'Vertical', value: 'vertical' },
  { label: 'Organic', value: 'organic' },
]
const hasNodes = computed(() => props.nodeOptions.length > 0)
const canFocusSelected = computed(() =>
  Boolean(props.selectedNodeId && props.visibleNodeIds.includes(props.selectedNodeId)),
)
const showAllNodes = () =>
  emit(
    'update:visibleNodeIds',
    props.nodeOptions.map(({ id }) => id),
  )
const setNodeVisible = (nodeId: string, visible: boolean) => {
  const next = visible
    ? [...new Set([...props.visibleNodeIds, nodeId])]
    : props.visibleNodeIds.filter((id) => id !== nodeId)
  emit('update:visibleNodeIds', next)
}
</script>

<style scoped>
.graph-canvas-controls {
  flex: 0 0 auto;
  min-height: 40px;
  padding: 4px 8px;
  overflow-x: auto;
}

.graph-canvas-controls__node-list {
  width: min(360px, 80vw);
  max-height: 60vh;
  overflow-y: auto;
}
</style>
