<!-- DockView.vue -->
<template>
  <div
    ref="containerRef"
    class="dock-node"
    :class="{
      'dock-row': node.type === 'container' && node.direction === 'row',
      'dock-col': node.type === 'container' && node.direction === 'column',
    }"
    :style="{ flex: node.size ?? 1 }"
  >
    <!-- Container Node -->
    <template v-if="node.type === 'container' && node.children && node.children.length">
      <template v-for="(child, index) in node.children" :key="child.id">
        <!-- Non-null assertion on children to satisfy TS (DockNode, not DockNode | undefined) -->
        <DockView
          v-model:node="node.children![index]!"
          :show-tab-add="props.showTabAdd"
          :show-tab-close="props.showTabClose"
          @add-view="onChildAddView"
        >
          <!-- Forward all slots -->
          <template v-for="(_, slotName) in $slots" :key="slotName" #[slotName]="slotProps">
            <!-- slotProps is now typed as an object so v-bind is OK -->
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </DockView>

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
          v-for="(viewId, index) in node.views || []"
          :key="viewId"
          class="dock-tab"
          :class="{ active: index === (node.activeViewIndex ?? 0) }"
          @click="onTabClick(index)"
        >
          <span class="dock-tab-title">{{ viewId }}</span>
          <button
            v-if="props.showTabClose"
            class="dock-tab-close"
            type="button"
            @click.stop="onTabClose(viewId)"
          >
            ×
          </button>
        </div>

        <!-- Plus button to add a new tab in this leaf -->
        <button
          v-if="props.showTabAdd"
          class="dock-tab-add"
          type="button"
          @click.stop="onAddTabClick"
        >
          +
        </button>
      </div>

      <div class="dock-content">
        <template v-if="node.views && node.views.length > 0">
          <slot :name="node.views[node.activeViewIndex ?? 0]" />
        </template>
        <div v-else class="dock-empty">No Views</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, useSlots } from 'vue'

/* ---------- Types ---------- */

export type DockDirection = 'row' | 'column'

export interface DockNode {
  id: string
  type: 'container' | 'leaf'

  // container
  direction?: DockDirection
  children?: DockNode[]

  // leaf
  views?: string[]
  activeViewIndex?: number

  // layout
  size?: number // flex weight
}

/* ---------- Add-view event types ---------- */

export interface AddViewContext {
  /** id of the leaf where "+" was clicked (e.g. "editors", "panel", "sidebar") */
  leafId: string
  /** current view ids (slot names) in that leaf */
  currentViews: string[]
  /** all slot names available on this DockView instance */
  availableViewTypes: string[]
}

export interface AddViewResult {
  /** name of the slot to add as a new tab (e.g. "New_File_3", "Process_2") */
  viewId: string
  /** whether the new tab should become active (default: true) */
  makeActive?: boolean
}

const props = withDefaults(
  defineProps<{
    /** Show the "x" close button on each tab (default: true) */
    showTabClose?: boolean
    /** Show the "+" add-tab button (default: true) */
    showTabAdd?: boolean
  }>(),
  {
    showTabClose: true,
    showTabAdd: true,
  },
)

/** Callback that the parent calls once it knows what to add */
export type AddViewDone = (result: AddViewResult | null | undefined) => void

/* ---------- v-model ---------- */

// Expose `v-model:node`
const nodeModel = defineModel<DockNode>('node', { required: true })

// Alias for template (auto unwrapped)
const node = nodeModel

/* ---------- Slots typing ---------- */
/**
 * We declare slot props as an object type so that `v-bind="slotProps"` is valid.
 * Using `unknown` here would cause the "Spread types may only be created from object types" error.
 */
defineSlots<Record<string, (props: Record<string, unknown>) => unknown>>()

const slots = useSlots()

/* ---------- Emits ---------- */

const emit = defineEmits<{
  (e: 'add-view', ctx: AddViewContext, done: AddViewDone): void
}>()

/* ---------- Pure helpers (functional style) ---------- */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const setActiveView = (n: DockNode, index: number): DockNode => {
  if (n.type !== 'leaf' || !n.views || n.views.length === 0) return n
  const clamped = clamp(index, 0, n.views.length - 1)
  if (clamped === (n.activeViewIndex ?? 0)) return n
  return { ...n, activeViewIndex: clamped }
}

const closeView = (n: DockNode, viewId: string): DockNode => {
  if (n.type !== 'leaf' || !n.views) return n

  const idx = n.views.indexOf(viewId)
  if (idx === -1) return n

  const views = n.views.filter((_, i) => i !== idx)
  let active = n.activeViewIndex ?? 0

  if (views.length === 0) {
    active = 0
  } else if (active >= views.length) {
    active = views.length - 1
  } else if (idx <= active && active > 0) {
    active = active - 1
  }

  return { ...n, views, activeViewIndex: active }
}

const resizeChildren = (n: DockNode, splitterIndex: number, deltaWeight: number): DockNode => {
  if (n.type !== 'container' || !n.children || n.children.length < 2) return n

  const children = n.children
  const left = children[splitterIndex]
  const right = children[splitterIndex + 1]

  if (!left || !right) return n

  const leftSize = left.size ?? 1
  const rightSize = right.size ?? 1

  const newLeft = Math.max(0.1, leftSize + deltaWeight)
  const newRight = Math.max(0.1, rightSize - deltaWeight)

  const newChildren = children.map((child, idx) => {
    if (idx === splitterIndex) return { ...child, size: newLeft }
    if (idx === splitterIndex + 1) return { ...child, size: newRight }
    return child
  })

  return { ...n, children: newChildren }
}

/** Add a view id to a leaf node (used when "+" is confirmed by parent) */
const addViewToLeaf = (n: DockNode, viewId: string, makeActive = true): DockNode => {
  if (n.type !== 'leaf') return n
  const views = [...(n.views ?? []), viewId]
  const activeViewIndex = makeActive ? views.length - 1 : (n.activeViewIndex ?? 0)
  return { ...n, views, activeViewIndex }
}

/* ---------- Resizing logic ---------- */

const containerRef = ref<HTMLElement | null>(null)
const isResizing = ref(false)
const activeSplitterIndex = ref(-1)

const handleMouseMove = (event: MouseEvent) => {
  if (!isResizing.value || !containerRef.value) return

  const current = node.value
  if (current.type !== 'container' || !current.children || !current.direction) return

  const rect = containerRef.value.getBoundingClientRect()
  const totalSize = current.direction === 'row' ? rect.width : rect.height
  if (!totalSize) return

  const delta = current.direction === 'row' ? event.movementX : event.movementY
  const totalWeight = current.children.reduce((acc, child) => acc + (child.size ?? 1), 0)
  const weightPerPixel = totalWeight / totalSize
  const deltaWeight = delta * weightPerPixel

  node.value = resizeChildren(current, activeSplitterIndex.value, deltaWeight)
}

const stopResize = () => {
  if (!isResizing.value) return
  isResizing.value = false
  activeSplitterIndex.value = -1
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
}

const startResize = (index: number, event: MouseEvent) => {
  event.preventDefault()
  if (node.value.type !== 'container' || !node.value.direction) return

  isResizing.value = true
  activeSplitterIndex.value = index

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = node.value.direction === 'row' ? 'col-resize' : 'row-resize'
}

onUnmounted(() => {
  stopResize()
})

/* ---------- Tab handlers ---------- */

const onTabClick = (index: number) => {
  node.value = setActiveView(node.value, index)
}

const onTabClose = (viewId: string) => {
  node.value = closeView(node.value, viewId)
}

/* ---------- Add tab ("+") handlers ---------- */

/**
 * Called when "+" in a leaf tab bar is clicked.
 * Emits 'add-view' with context and a callback to complete the addition.
 */
const onAddTabClick = () => {
  if (node.value.type !== 'leaf') return

  const ctx: AddViewContext = {
    leafId: node.value.id,
    currentViews: node.value.views ?? [],
    availableViewTypes: Object.keys(slots),
  }

  const done: AddViewDone = (result) => {
    if (!result || !result.viewId) return
    node.value = addViewToLeaf(node.value, result.viewId, result.makeActive ?? true)
  }

  emit('add-view', ctx, done)
}

/**
 * Forward add-view events from children up the tree.
 * This way the top-level parent (DockViewTest) can handle everything.
 */
const onChildAddView = (ctx: AddViewContext, done: AddViewDone) => {
  emit('add-view', ctx, done)
}
</script>

<style scoped>
.dock-node {
  display: flex;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* Default direction for leaf nodes */
.dock-node:not(.dock-row):not(.dock-col) {
  flex-direction: column;
}

.dock-row {
  flex-direction: row;
}

.dock-col {
  flex-direction: column;
}

/* Splitter */
.dock-splitter {
  position: relative;
  flex-shrink: 0;
  /* hit area color not really visible; inner line uses currentColor */
}

/* Horizontal split (vertical splitter line) */
.dock-splitter.row {
  /* Wider hitbox, still easy to grab */
  width: 8px;
  cursor: col-resize;
}

/* Vertical split (horizontal splitter line) */
.dock-splitter.column {
  /* Taller hitbox, still easy to grab */
  height: 8px;
  cursor: row-resize;
}

/* Actual visible line */
.dock-splitter::before {
  content: '';
  position: absolute;
  background-color: currentColor; /* matches text color */
  border-radius: 999px; /* fully rounded ends */
}

/* Inner line for vertical splitter (between left/right panels) */
.dock-splitter.row::before {
  /* Thin vertical line */
  width: 2px;
  /* leave small gaps top/bottom so it does not touch panels */
  top: 4px;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
}

/* Inner line for horizontal splitter (between top/bottom panels) */
.dock-splitter.column::before {
  /* Thin horizontal line */
  height: 2px;
  /* leave small gaps left/right so it does not touch panels */
  left: 4px;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

/* Tabs */
.dock-tabs-header {
  display: flex;
  flex-shrink: 0;
  overflow-x: auto;
  align-items: center;
}

.dock-tab {
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  cursor: pointer;
  white-space: nowrap;
}

.dock-tab.active {
  font-weight: 600;
}

.dock-tab-title {
  flex: 1;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
}

.dock-tab-close,
.dock-tab-add {
  margin-left: 0.25rem;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 0.25rem;
  flex-shrink: 0;
  font-size: 1rem;

  /* new: match text color */
  color: inherit;
}

/* Content */
.dock-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.dock-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
