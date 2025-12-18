<!-- DockView.vue -->
<template>
  <div
    ref="containerRef"
    class="dock-node"
    :class="{
      'dock-row': node.type === 'container' && node.direction === 'row',
      'dock-col': node.type === 'container' && node.direction === 'column',
      'dock-resizing': isResizing,
    }"
    :style="nodeStyle"
  >
    <!-- Container Node -->
    <template v-if="node.type === 'container' && node.children && node.children.length">
      <template v-for="(child, index) in node.children" :key="child.id">
        <DockView
          v-model:node="node.children![index]!"
          :hide-tab-add="props.hideTabAdd"
          :hide-tab-close="props.hideTabClose"
          :tab-class="props.tabClass"
          :active-tab-class="props.activeTabClass"
          :tab-button-class="props.tabButtonClass"
          :add-button-class="props.addButtonClass"
          :tab-icons="props.tabIcons"
          @add-view="onChildAddView"
        >
          <!-- Forward all slots -->
          <template v-for="(_, slotName) in $slots" :key="slotName" #[slotName]="slotProps">
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </DockView>

        <!-- Splitter -->
        <div
          v-if="isSplitterResizable(index) && index < node.children.length - 1"
          class="dock-splitter"
          :class="[
            node.direction,
            isSplitterResizable(index) ? 'dock-splitter--enabled' : 'dock-splitter--disabled',
          ]"
          @mousedown="isSplitterResizable(index) && startResize(index, $event)"
        ></div>
      </template>
    </template>

    <!-- Leaf Node (Tabs) -->
    <template v-else-if="node.type === 'leaf'">
      <!-- Tabs header (may be hidden depending on showTabs) -->
      <div v-if="showTabs" class="dock-tabs-header">
        <div
          v-for="(viewId, index) in node.views || []"
          :key="viewId"
          class="dock-tab"
          :class="[
            props.tabClass,
            { active: index === (node.activeViewIndex ?? 0) },
            index === (node.activeViewIndex ?? 0) && props.activeTabClass,
          ]"
          @click="onTabClick(index)"
        >
          <!-- Optional SVG icon -->
          <q-icon
            v-if="props.tabIcons?.[viewId]"
            class="dock-tab-icon"
            :name="props.tabIcons[viewId]"
          />
          <span class="dock-tab-title">{{ viewId }}</span>

          <button
            v-if="!props.hideTabClose"
            class="dock-tab-close"
            type="button"
            :class="props.tabButtonClass"
            @click.stop="onTabClose(viewId)"
          >
            ×
          </button>
        </div>

        <!-- Plus button to add a new tab in this leaf -->
        <button
          v-if="!props.hideTabAdd"
          class="dock-tab-add"
          type="button"
          :class="props.addButtonClass"
          @click.stop="onAddTabClick"
        >
          +
        </button>
      </div>

      <!-- Content-sized leaves: keep simple, participate in layout -->
      <div v-if="isContentSizedLeaf" class="dock-content dock-content--content">
        <template v-if="node.views && node.views.length > 0">
          <slot :name="node.views[node.activeViewIndex ?? 0]" />
        </template>
        <div v-else class="dock-empty">No Views</div>
      </div>

      <!-- Weight-based leaves: isolate content in an absolute scroller -->
      <div v-else class="dock-content dock-content--weight">
        <div class="dock-content-inner">
          <template v-if="node.views && node.views.length > 0">
            <slot :name="node.views[node.activeViewIndex ?? 0]" />
          </template>
          <div v-else class="dock-empty">No Views</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, useSlots, computed } from 'vue'

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
  /**
   * Controls whether the tab header is shown.
   * - "always": header is always visible (default)
   * - "auto": hide when 0 or 1 tab
   * - "never": never show tabs (e.g. menu bars, static views)
   */
  showTabs?: 'always' | 'auto' | 'never'

  // layout
  size?: number // flex "weight"
  /**
   * 'weight' (default): flex-grow with given size
   * 'content': shrink/grow to min content size (e.g. menu bar region)
   */
  sizeMode?: 'weight' | 'content'
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

/** Callback that the parent calls once it knows what to add */
export type AddViewDone = (result: AddViewResult | null | undefined) => void

/* ---------- Props ---------- */

const props = withDefaults(
  defineProps<{
    /** Show the "x" close button on each tab (default: true) */
    hideTabClose?: boolean
    /** Show the "+" add-tab button (default: true) */
    hideTabAdd?: boolean

    /** Extra CSS classes for easier styling from parent */
    tabClass?: string
    activeTabClass?: string
    tabButtonClass?: string
    addButtonClass?: string

    /** Map viewId -> raw SVG string (trusted HTML) for tab icons */
    tabIcons?: Record<string, string>
  }>(),
  {
    hideTabClose: false,
    hideTabAdd: false,

    // these can be whatever you like – empty string / undefined / {}
    tabClass: '',
    activeTabClass: '',
    tabButtonClass: '',
    addButtonClass: '',
    tabIcons: () => ({}),
  },
)

/* ---------- v-model ---------- */

const nodeModel = defineModel<DockNode>('node', { required: true })
const node = nodeModel

/* ---------- Slots typing ---------- */

defineSlots<Record<string, (props: Record<string, unknown>) => unknown>>()
const slots = useSlots()

/* ---------- Emits ---------- */

const emit = defineEmits<{
  (e: 'add-view', ctx: AddViewContext, done: AddViewDone): void
}>()

/* ---------- Pure helpers ---------- */

const isSplitterResizable = (splitterIndex: number): boolean => {
  const n = node.value
  if (n.type !== 'container' || !n.children) return false

  const left = n.children[splitterIndex]
  const right = n.children[splitterIndex + 1]
  if (!left || !right) return false

  // disable if either side is content-sized
  return left.sizeMode !== 'content' && right.sizeMode !== 'content'
}

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

/* ---------- Layout-related computed ---------- */

/** Whether to show the tab header for this leaf node */
const showTabs = computed(() => {
  if (node.value.type !== 'leaf') return false

  const mode = node.value.showTabs ?? 'always'
  const count = node.value.views?.length ?? 0

  if (mode === 'never') return false
  if (mode === 'always') return true
  // 'auto'
  return count > 1
})

/** Flex style respecting size / sizeMode */
const nodeStyle = computed(() => {
  const n = node.value
  const mode = n.sizeMode ?? 'weight'

  if (mode === 'content') {
    // shrink to fit content, don't stretch
    return { flex: '0 0 auto' }
  }

  const weight = n.size ?? 1
  // grow according to weight, allow shrink, no fixed basis
  return { flex: `${weight} 1 0` }
})

/* ---------- Resizing logic ---------- */

const containerRef = ref<HTMLElement | null>(null)
const isResizing = ref(false)
const activeSplitterIndex = ref(-1)

const isContentSizedLeaf = computed(
  () => node.value.type === 'leaf' && (node.value.sizeMode ?? 'weight') === 'content',
)

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

/** Forward add-view events from children up the tree. */
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

.dock-resizing :deep(iframe) {
  pointer-events: none !important;
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
  /* very subtle by default */
  color: rgba(0, 0, 0, 0.11);
  background: transparent;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

/* Horizontal split (vertical splitter line) */
.dock-splitter.row {
  width: 8px;
}

/* Vertical split (horizontal splitter line) */
.dock-splitter.column {
  height: 8px;
}

/* Only enabled splitters get resize cursors */
.dock-splitter--enabled.row {
  cursor: col-resize;
}

.dock-splitter--enabled.column {
  cursor: row-resize;
}

/* Actual visible line */
.dock-splitter::before {
  content: '';
  position: absolute;
  background-color: currentColor;
  border-radius: 999px;
  transition:
    background-color 0.15s ease,
    width 0.15s ease,
    height 0.15s ease;
}

/* Idle: thin, low contrast line */
.dock-splitter.row::before {
  width: 2px;
  top: 4px;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
}

.dock-splitter.column::before {
  height: 2px;
  left: 4px;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

/* Hover: stronger color, slight background, thicker line – only when enabled */
.dock-splitter--enabled:hover {
  color: color-mix(in srgb, currentColor 45%, transparent);
  background-color: color-mix(in srgb, currentColor 4%, transparent);
}

.dock-splitter--enabled.row:hover::before {
  width: 4px;
}

.dock-splitter--enabled.column:hover::before {
  height: 4px;
}

/* Tabs */
.dock-tabs-header {
  display: flex;
  flex-shrink: 0;
  overflow-x: auto;
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  /*background: color-mix(in srgb, currentColor 2%, transparent);*/
}

.dock-tab {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.dock-tab:hover {
  background: color-mix(in srgb, currentColor 4%, transparent);
}

.dock-tab.active {
  font-weight: 600;
  border-bottom-color: currentColor;
  background: color-mix(in srgb, currentColor 7%, transparent);
}

.dock-tab-title {
  flex: 1;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
}

/* Icons */
.dock-tab-icon {
  display: inline-flex;
  align-items: center;
  margin-right: 0.25rem;
  flex-shrink: 0;
}

.dock-tab-icon svg {
  width: 1em;
  height: 1em;
  fill: currentColor;
}

/* Buttons */
.dock-tab-close,
.dock-tab-add {
  margin-left: 0.25rem;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 0.25rem;
  flex-shrink: 0;
  font-size: 1rem;
  color: inherit;
}

/* Content */
/* Base: shared bits */
.dock-content {
  min-width: 0;
  min-height: 0;
}

/* For sizeMode: 'content' leaves (e.g. 'actions') */
.dock-content--content {
  /* Let the content define the leaf's size; do NOT try to fill */
  flex: 0 0 auto; /* or just omit 'flex' entirely */
  overflow: visible; /* content can spill as needed */
}

/* For weight-based leaves (editors, etc.) */
.dock-content--weight {
  position: relative;
  flex: 1 1 0;
  overflow: hidden; /* isolate scrollable inner layer */
}

/* Absolute inner scroller ONLY for weight-based leaves */
.dock-content-inner {
  position: absolute;
  inset: 0;
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

/* Optional: make "No Views" fill the available area in weight-based leaves.
   For content leaves, you typically won't hit .dock-empty anyway. */
.dock-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
