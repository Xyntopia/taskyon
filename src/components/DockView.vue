<!-- src/pages/DockView.vue -->
<template>
  <div
    ref="containerRef"
    class="dock-node"
    :class="{
      'dock-root': isRoot,
      'dock-row': node.type === 'container' && node.direction === 'row',
      'dock-col': node.type === 'container' && node.direction === 'column',
    }"
    :style="{ flex: node.size ?? 1 }"
  >
    <!-- Container Node -->
    <template v-if="node.type === 'container' && node.children">
      <template v-for="(child, index) in node.children" :key="child.id">
        <!-- Recursive Child -->
        <DockLayout :node="child" @close-view="(nId, vId) => emit('close-view', nId, vId)">
          <!-- Forward all slots -->
          <template v-for="(_, slot) in $slots" #[slot]="scope">
            <slot :name="slot" v-bind="scope" />
          </template>
        </DockLayout>

        <!-- Splitter -->
        <div
          v-if="index < node.children.length - 1"
          class="dock-splitter"
          :class="node.direction"
          @mousedown="startResize(index, $event)"
        ></div>
      </template>
    </template>

    <!-- Leaf Node (Tabs) -->
    <template v-else-if="node.type === 'leaf'">
      <div class="dock-tabs-header">
        <div
          v-for="(viewId, index) in node.views"
          :key="viewId"
          class="dock-tab"
          :class="{ active: index === (node.activeViewIndex || 0) }"
          @click="setActiveTab(index)"
        >
          <span class="dock-tab-title">{{ viewId }}</span>
          <button class="dock-tab-close" @click.stop="closeTab(viewId)">×</button>
        </div>
      </div>
      <div class="dock-content">
        <!-- Render the active view slot -->
        <template v-if="node.views && node.views.length > 0">
          <slot :name="node.views[node.activeViewIndex || 0]" />
        </template>
        <div v-else class="dock-empty">No Views</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// --- Types ---
export type DockDirection = 'row' | 'column'

export interface DockNode {
  id: string
  type: 'container' | 'leaf'
  direction?: DockDirection // Only for container
  children?: DockNode[] // Only for container
  views?: string[] // Only for leaf (array of template keys)
  activeViewIndex?: number // Only for leaf
  size?: number // Relative size (weight) for flex-grow
}

const props = defineProps<{
  node: DockNode
  isRoot?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:node', node: DockNode): void
  (e: 'close-view', nodeId: string, viewId: string): void
  (e: 'select-view', nodeId: string, viewIndex: number): void
}>()

// --- Resizing Logic ---
const containerRef = ref<HTMLElement | null>(null)
const isResizing = ref(false)
const activeSplitterIndex = ref(-1)

const startResize = (index: number, event: MouseEvent) => {
  event.preventDefault()
  isResizing.value = true
  activeSplitterIndex.value = index

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = props.node.direction === 'row' ? 'col-resize' : 'row-resize'
}

const handleMouseMove = (event: MouseEvent) => {
  if (!isResizing.value || !containerRef.value || !props.node.children) return

  const containerRect = containerRef.value.getBoundingClientRect()
  const index = activeSplitterIndex.value
  const node1 = props.node.children[index]
  const node2 = props.node.children[index + 1]

  if (!node1 || !node2) return

  const totalSize = props.node.direction === 'row' ? containerRect.width : containerRect.height
  const delta = props.node.direction === 'row' ? event.movementX : event.movementY

  // Calculate relative change
  // We are using 'size' as flex-grow weights.
  // To keep it proportional, we need to know the total weight of the two resizing nodes.
  // But a simpler approach for flex-grow is to just adjust the weights directly based on pixels if we know the pixel-to-weight ratio.
  // Alternatively, we can use percentages.

  // Let's assume size is roughly proportional to pixels for now or normalize it.
  // If we sum all sizes in children, that equals container size.
  const totalWeight = props.node.children.reduce((acc, child) => acc + (child.size || 1), 0)
  const weightPerPixel = totalWeight / totalSize

  const deltaWeight = delta * weightPerPixel

  // Update sizes
  // We need to mutate the props deeply or emit an update.
  // Since we passed a reactive object, mutating it is the Vue way for this kind of tight coupling,
  // or we emit a new tree. Mutating is faster for resizing.
  // For 'clean' architecture, we should emit. But for 'self-contained' simple component, mutation is often accepted if documented.
  // Let's try to be nice and emit, but mutating deeply nested prop is tricky without a store.
  // We will assume the parent passed a reactive object and we can mutate it for performance.

  if (node1.size === undefined) node1.size = 1
  if (node2.size === undefined) node2.size = 1

  const newSize1 = Math.max(0.1, node1.size + deltaWeight)
  const newSize2 = Math.max(0.1, node2.size - deltaWeight)

  node1.size = newSize1
  node2.size = newSize2
}

const stopResize = () => {
  isResizing.value = false
  activeSplitterIndex.value = -1
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
}

// --- Tab Logic ---
const setActiveTab = (index: number) => {
  if (props.node.type === 'leaf') {
    props.node.activeViewIndex = index
  }
}

const closeTab = (viewId: string) => {
  // This needs to be handled by parent to remove from array
  // We emit an event up
  emit('close-view', props.node.id, viewId)
}
</script>

<style scoped>
.dock-node {
  display: flex;
  overflow: hidden;
  position: relative;
  min-width: 0;
  min-height: 0;
  background-color: var(--dock-bg, #1e1e1e);
  color: var(--dock-fg, #cccccc);
}

.dock-root {
  width: 100%;
  height: 100%;
}

.dock-row {
  flex-direction: row;
}

.dock-col {
  flex-direction: column;
}

/* Splitter */
.dock-splitter {
  z-index: 10;
  background-color: var(--dock-splitter-bg, #2b2b2b);
  flex-shrink: 0;
  transition: background-color 0.2s;
}

.dock-splitter:hover,
.dock-splitter:active {
  background-color: var(--dock-splitter-active, #007fd4);
}

.dock-splitter.row {
  width: 4px;
  cursor: col-resize;
}

.dock-splitter.column {
  height: 4px;
  cursor: row-resize;
}

/* Tabs */
.dock-tabs-header {
  display: flex;
  height: 35px;
  background-color: var(--dock-header-bg, #252526);
  border-bottom: 1px solid var(--dock-border, #3e3e3e);
  overflow-x: auto;
  flex-shrink: 0;
}

.dock-tab {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 13px;
  cursor: pointer;
  background-color: var(--dock-tab-bg, #2d2d2d);
  border-right: 1px solid var(--dock-border, #1e1e1e);
  color: #969696;
  user-select: none;
  min-width: 100px;
  max-width: 200px;
}

.dock-tab:hover {
  background-color: var(--dock-tab-hover, #2a2d2e);
}

.dock-tab.active {
  background-color: var(--dock-bg, #1e1e1e);
  color: white;
  border-top: 1px solid var(--dock-accent, #007fd4);
}

.dock-tab-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dock-tab-close {
  background: none;
  border: none;
  color: inherit;
  margin-left: 8px;
  cursor: pointer;
  border-radius: 3px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.dock-tab:hover .dock-tab-close {
  opacity: 1;
}

.dock-tab-close:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

/* Content */
.dock-content {
  flex: 1;
  overflow: auto;
  position: relative;
  display: flex;
  flex-direction: column;
}

.dock-node:not(.dock-row):not(.dock-col) {
  flex-direction: column;
}

.dock-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}
</style>
