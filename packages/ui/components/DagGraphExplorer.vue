<template>
  <div class="dag-graph-explorer fit column no-wrap">
    <q-tree
      v-if="mode === 'tree'"
      :nodes="treeNodes"
      node-key="id"
      label-key="label"
      v-bind="selectedNodeId ? { selected: selectedNodeId } : {}"
      dense
      default-expand-all
      class="col q-pa-sm scroll"
      @update:selected="selectNode"
    >
      <template #default-header="{ node }">
        <div class="dag-graph-explorer__tree-node">
          <div class="dag-graph-explorer__tree-label">
            <div>{{ node.label }}</div>
            <div v-if="node.caption" class="text-caption text-grey-7">{{ node.caption }}</div>
          </div>
          <slot name="tree-node-actions" :node="node" />
        </div>
      </template>
    </q-tree>
    <GraphCanvas v-else class="col" :graph="graph" :options="options" />
  </div>
</template>

<script setup lang="ts">
import type { GraphData, RenderOptions } from '@taskyon/common/modules/graph'
import type { QTreeNode } from 'quasar'
import GraphCanvas from './GraphCanvas.vue'

defineSlots<{
  'tree-node-actions': (props: { node: QTreeNode }) => unknown
}>()

defineProps<{
  mode: 'tree' | 'graph'
  graph: GraphData
  treeNodes: QTreeNode[]
  options: RenderOptions
  selectedNodeId?: string
}>()

const emit = defineEmits<{ selectNode: [nodeId: string] }>()
const selectNode = (nodeId: string | null) => {
  if (nodeId) emit('selectNode', nodeId)
}
</script>

<style scoped>
.dag-graph-explorer {
  min-width: 0;
  min-height: 0;
}

.dag-graph-explorer__tree-node {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
}

.dag-graph-explorer__tree-label {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
