<template>
  <div ref="explorerRef" class="dag-graph-explorer fit column no-wrap">
    <div v-if="searchable && mode !== 'tree'" class="dag-graph-explorer__search q-pa-sm">
      <div class="row items-center q-gutter-xs no-wrap">
        <q-input
          v-model="query"
          dense
          outlined
          clearable
          debounce="100"
          placeholder="Search nodes"
          aria-label="Search graph nodes"
          class="col"
        >
          <template #prepend><q-icon :name="matSearch" /></template>
        </q-input>
        <q-select
          v-if="filterOptions.length > 0"
          v-model="activeFilter"
          dense
          outlined
          emit-value
          map-options
          :options="filterOptions"
          aria-label="Filter graph nodes"
          class="dag-graph-explorer__filter"
        />
        <slot name="toolbar-actions" />
        <q-btn
          v-if="allowCreateNode"
          flat
          round
          dense
          :icon="matAdd"
          aria-label="Create node"
          @click="emit('createNode')"
        >
          <q-tooltip>Create node</q-tooltip>
        </q-btn>
      </div>
      <q-list v-if="mode === 'graph' && query && searchResults.length" dense bordered separator>
        <q-item
          v-for="result in searchResults"
          :key="result.id"
          clickable
          @click="chooseSearchResult(result.id)"
        >
          <q-item-section>
            <q-item-label>{{ result.label ?? result.id }}</q-item-label>
            <q-item-label caption>{{ result.id }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
      <div v-else-if="mode === 'graph' && query" class="text-caption q-pa-sm">
        No matching nodes.
      </div>
    </div>
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
    <GraphCanvas
      v-else-if="mode === 'graph'"
      ref="graphCanvas"
      class="col"
      :graph="filteredGraph"
      :options="options"
      v-bind="{
        ...(presentation ? { presentation } : {}),
        ...(selectedNodeId ? { selectedNodeId } : {}),
      }"
      @select-node="selectNode"
      @node-context-menu="openContextMenu"
      @update:presentation="emit('update:presentation', $event)"
    >
      <template #controls><slot name="graph-controls" /></template>
    </GraphCanvas>
    <div v-else class="dag-graph-explorer__list col column no-wrap">
      <div class="row items-center q-gutter-sm q-px-sm q-pb-sm">
        <q-checkbox
          :model-value="allVisibleSelectableNodesSelected"
          :disable="visibleSelectableNodeIds.length === 0"
          label="Select visible"
          @update:model-value="setAllVisibleSelected"
        />
        <div class="text-caption">{{ selectedListNodeIds.length }} selected</div>
        <q-space />
        <slot
          name="list-actions"
          :selected-node-ids="selectedListNodeIds"
          :clear-selection="clearListSelection"
        />
      </div>
      <q-list dense bordered separator class="col scroll">
        <q-item
          v-for="node in listNodes"
          :key="node.id"
          @contextmenu.prevent="openContextMenuFromMouse(node.id, $event)"
        >
          <q-item-section side>
            <q-checkbox
              :model-value="selectedListNodeIds.includes(node.id)"
              :disable="!selectableNodeIds.includes(node.id)"
              @click.stop="toggleListNodeSelection(node.id)"
            />
          </q-item-section>
          <q-item-section class="cursor-pointer" @click="selectNode(node.id)">
            <q-item-label>{{ node.label ?? node.id }}</q-item-label>
            <q-item-label caption>{{ node.id }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <slot name="list-node-actions" :node="node" />
          </q-item-section>
        </q-item>
        <q-item v-if="listNodes.length === 0">
          <q-item-section>No matching nodes.</q-item-section>
        </q-item>
      </q-list>
    </div>
    <div
      ref="contextMenuAnchor"
      class="dag-graph-explorer__context-anchor"
      :style="contextMenuAnchorStyle"
    ></div>
    <ResponsiveMenuDialog v-model="contextMenuOpen" auto-close :target="contextMenuAnchor ?? false">
      <slot
        v-if="contextMenuNodeId"
        name="node-context-menu"
        :node-id="contextMenuNodeId"
        :close="closeContextMenu"
        :clear-selection="clearListSelection"
      />
    </ResponsiveMenuDialog>
  </div>
</template>

<script setup lang="ts" generic="N = unknown, E = unknown">
import { matAdd, matSearch } from '@quasar/extras/material-icons'
import {
  filterVisibleGraph,
  type GraphData,
  type GraphNode,
  type GraphPresentationState,
  type RenderOptions,
} from '@taskyon/common/modules/graph'
import type { QTreeNode } from 'quasar'
import { computed, nextTick, ref } from 'vue'
import GraphCanvas from './GraphCanvas.vue'
import ResponsiveMenuDialog from './ResponsiveMenuDialog.vue'

defineSlots<{
  'tree-node-actions': (props: { node: QTreeNode }) => unknown
  'graph-controls': () => unknown
  'toolbar-actions': () => unknown
  'list-actions': (props: { selectedNodeIds: string[]; clearSelection: () => void }) => unknown
  'list-node-actions': (props: { node: GraphNode<N> }) => unknown
  'node-context-menu': (props: {
    nodeId: string
    close: () => void
    clearSelection: () => void
  }) => unknown
}>()

const props = withDefaults(
  defineProps<{
    mode: 'tree' | 'graph' | 'list'
    graph: GraphData<N, E>
    treeNodes: QTreeNode[]
    options: RenderOptions<N, E>
    selectedNodeId?: string
    searchable?: boolean
    filterOptions?: Array<{ label: string; value: string; nodeIds: string[] }>
    allowCreateNode?: boolean
    selectableNodeIds?: string[]
    presentation?: GraphPresentationState
  }>(),
  {
    searchable: false,
    filterOptions: () => [],
    allowCreateNode: false,
    selectableNodeIds: () => [],
  },
)

const emit = defineEmits<{
  selectNode: [nodeId: string]
  createNode: []
  'update:presentation': [presentation: GraphPresentationState]
}>()
const query = ref('')
const activeFilter = ref(props.filterOptions[0]?.value ?? '')
const selectedListNodeIds = ref<string[]>([])
const explorerRef = ref<HTMLElement | null>(null)
const contextMenuAnchor = ref<HTMLElement | null>(null)
const contextMenuOpen = ref(false)
const contextMenuNodeId = ref('')
const contextMenuPosition = ref({ left: 0, top: 0 })
const graphCanvas = ref<{ showNode: (nodeId: string) => Promise<boolean> } | null>(null)
const filteredGraph = computed(() => {
  const selected = props.filterOptions.find(({ value }) => value === activeFilter.value)
  return selected ? filterVisibleGraph(props.graph, new Set(selected.nodeIds)) : props.graph
})
const searchResults = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  if (!normalized) return []
  return filteredGraph.value.nodes
    .filter(({ id, label }) =>
      [id, label ?? ''].some((value) => value.toLocaleLowerCase().includes(normalized)),
    )
    .sort((left, right) => (left.label ?? left.id).localeCompare(right.label ?? right.id))
    .slice(0, 20)
})
const listNodes = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  if (!normalized) return filteredGraph.value.nodes
  return filteredGraph.value.nodes.filter(({ id, label }) =>
    [id, label ?? ''].some((value) => value.toLocaleLowerCase().includes(normalized)),
  )
})
const visibleSelectableNodeIds = computed(() => {
  const selectable = new Set(props.selectableNodeIds)
  return listNodes.value.map(({ id }) => id).filter((id) => selectable.has(id))
})
const allVisibleSelectableNodesSelected = computed(
  () =>
    visibleSelectableNodeIds.value.length > 0 &&
    visibleSelectableNodeIds.value.every((id) => selectedListNodeIds.value.includes(id)),
)
const contextMenuAnchorStyle = computed(() => ({
  left: `${contextMenuPosition.value.left}px`,
  top: `${contextMenuPosition.value.top}px`,
}))
const selectNode = (nodeId: string | null) => {
  if (nodeId) emit('selectNode', nodeId)
}
const chooseSearchResult = (nodeId: string) => {
  void graphCanvas.value?.showNode(nodeId)
  selectNode(nodeId)
}
const toggleListNodeSelection = (nodeId: string) => {
  selectedListNodeIds.value = selectedListNodeIds.value.includes(nodeId)
    ? selectedListNodeIds.value.filter((id) => id !== nodeId)
    : [...selectedListNodeIds.value, nodeId]
}
const setAllVisibleSelected = (selected: boolean) => {
  const visible = new Set(visibleSelectableNodeIds.value)
  selectedListNodeIds.value = selected
    ? [...new Set([...selectedListNodeIds.value, ...visible])]
    : selectedListNodeIds.value.filter((id) => !visible.has(id))
}
const clearListSelection = () => {
  selectedListNodeIds.value = []
}
const closeContextMenu = () => {
  contextMenuOpen.value = false
}
const openContextMenu = async (payload: { nodeId: string; clientX: number; clientY: number }) => {
  const bounds = explorerRef.value?.getBoundingClientRect()
  contextMenuNodeId.value = payload.nodeId
  contextMenuPosition.value = {
    left: payload.clientX - (bounds?.left ?? 0),
    top: payload.clientY - (bounds?.top ?? 0),
  }
  contextMenuOpen.value = false
  await nextTick()
  contextMenuOpen.value = true
}
const openContextMenuFromMouse = (nodeId: string, event: MouseEvent) => {
  void openContextMenu({ nodeId, clientX: event.clientX, clientY: event.clientY })
}
</script>

<style scoped>
.dag-graph-explorer {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.dag-graph-explorer__search {
  flex: 0 0 auto;
  max-height: 42%;
  overflow: auto;
}

.dag-graph-explorer__filter {
  width: 132px;
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

.dag-graph-explorer__list {
  min-height: 0;
}

.dag-graph-explorer__context-anchor {
  position: absolute;
  width: 1px;
  height: 1px;
  pointer-events: none;
}
</style>
