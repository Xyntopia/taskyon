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
          :parent-direction="node.direction"
          :hide-tab-add="hideTabAdd"
          :hide-tab-close="hideTabClose"
          :tab-class="tabClass"
          :active-tab-class="activeTabClass"
          :tab-button-class="tabButtonClass"
          :add-button-class="addButtonClass"
          :tab-icons="tabIcons"
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
        >
          <!-- Arrow to collapse the left / previous pane -->
          <button
            class="dock-splitter-btn dock-splitter-btn--prev"
            type="button"
            @mousedown.stop
            @click.stop="collapsePane(index, 'prev')"
          >
            {{ node.direction === 'row' ? '◀' : '▲' }}
          </button>

          <!-- Arrow to collapse the right / next pane -->
          <button
            class="dock-splitter-btn dock-splitter-btn--next"
            type="button"
            @mousedown.stop
            @click.stop="collapsePane(index, 'next')"
          >
            {{ node.direction === 'row' ? '▶' : '▼' }}
          </button>
        </div>
      </template>
    </template>

    <!-- Leaf Node (Tabs) -->
    <template v-else-if="node.type === 'leaf'">
      <!-- Tabs header: always shown if showTabs, even when collapsed (see showTabs computed) -->
      <div
        v-if="showTabs"
        class="dock-tabs-header"
        :class="{
          'dock-tabs-header--vertical': isCollapsed && parentDirection === 'row',
          'dock-tabs-header--collapsed': isCollapsed,
        }"
      >
        <!-- Plus button still available when not collapsed -->
        <button
          v-if="!hideTabAdd && !isCollapsed"
          class="dock-tab-add"
          type="button"
          :class="addButtonClass"
          @click.stop="onAddTabClick"
        >
          +
        </button>

        <div
          v-for="(viewId, index) in node.views || []"
          :key="viewId"
          class="dock-tab"
          :class="[
            tabClass,
            { active: index === (node.activeViewIndex ?? 0) },
            index === (node.activeViewIndex ?? 0) && activeTabClass,
          ]"
          @click="isCollapsed ? onCollapsedTabClick(index) : onTabClick(index)"
        >
          <q-icon v-if="tabIcons?.[viewId]" class="dock-tab-icon" :name="tabIcons[viewId]" />
          <span class="dock-tab-title">{{ viewId }}</span>

          <button
            v-if="!hideTabClose && !isCollapsed"
            class="dock-tab-close"
            type="button"
            :class="tabButtonClass"
            @click.stop="onTabClose(viewId)"
          >
            ×
          </button>
        </div>

        <!-- Minimize / restore button -->
        <button
          class="dock-tab-minimize"
          type="button"
          :class="tabButtonClass"
          @click.stop="toggleCollapse"
        >
          {{ isCollapsed ? '▢' : '▁' }}
        </button>
      </div>

      <!-- Normal content when NOT collapsed -->
      <template v-if="!isCollapsed">
        <!-- Content-sized leaves -->
        <div v-if="isContentSizedLeaf" class="dock-content dock-content--content">
          <template v-if="node.views && node.views.length > 0">
            <slot :name="node.views[node.activeViewIndex ?? 0]" />
          </template>
          <div v-else class="dock-empty">No Views</div>
        </div>

        <!-- Weight-based leaves -->
        <div v-else class="dock-content dock-content--weight">
          <div class="dock-content-inner">
            <template v-if="node.views && node.views.length > 0">
              <slot :name="node.views[node.activeViewIndex ?? 0]" />
            </template>
            <div v-else class="dock-empty">No Views</div>
          </div>
        </div>
      </template>
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

  /** whether this pane is collapsed (minimized) */
  collapsed?: boolean
  /** remembered flex weight when last non-collapsed */
  lastSize?: number
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

const {
  parentDirection = 'column',

  hideTabClose = false,
  hideTabAdd = false,

  // these can be whatever you like – empty string / undefined / {}
  tabClass = '',
  activeTabClass = '',
  tabButtonClass = '',
  addButtonClass = '',
  tabIcons = {},
} = defineProps<{
  parentDirection?: DockDirection | undefined

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
}>()

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

/**
 * Resize two adjacent children and implement "snap to collapse"
 * using a weight threshold derived from pixels.
 */
const resizeChildren = (
  n: DockNode,
  splitterIndex: number,
  deltaWeight: number,
  collapseWeightThreshold: number,
): DockNode => {
  if (n.type !== 'container' || !n.children || n.children.length < 2) return n

  const children = n.children
  const left = children[splitterIndex]
  const right = children[splitterIndex + 1]

  if (!left || !right) return n

  const leftSize = left.size ?? 1
  const rightSize = right.size ?? 1

  let newLeft = Math.max(0, leftSize + deltaWeight)
  let newRight = Math.max(0, rightSize - deltaWeight)

  const updated = [...children]

  // snap-to-collapse behavior (works for containers AND leaves)
  if (newLeft < collapseWeightThreshold) {
    // collapse left, give all weight to right
    updated[splitterIndex] = {
      ...left,
      collapsed: true,
      lastSize: left.lastSize ?? leftSize,
      size: 0,
    }
    updated[splitterIndex + 1] = {
      ...right,
      collapsed: false,
      size: leftSize + rightSize,
    }
  } else if (newRight < collapseWeightThreshold) {
    // collapse right, give all weight to left
    updated[splitterIndex] = {
      ...left,
      collapsed: false,
      size: leftSize + rightSize,
    }
    updated[splitterIndex + 1] = {
      ...right,
      collapsed: true,
      lastSize: right.lastSize ?? rightSize,
      size: 0,
    }
  } else {
    // normal resize – don't allow going smaller than the threshold
    newLeft = Math.max(collapseWeightThreshold, newLeft)
    newRight = Math.max(collapseWeightThreshold, newRight)

    updated[splitterIndex] = { ...left, collapsed: false, size: newLeft }
    updated[splitterIndex + 1] = { ...right, collapsed: false, size: newRight }
  }

  return { ...n, children: updated }
}

/** Add a view id to a leaf node (used when "+" is confirmed by parent) */
const addViewToLeaf = (n: DockNode, viewId: string, makeActive = true): DockNode => {
  if (n.type !== 'leaf') return n
  const views = [...(n.views ?? []), viewId]
  const activeViewIndex = makeActive ? views.length - 1 : (n.activeViewIndex ?? 0)
  return { ...n, views, activeViewIndex }
}

/* ---------- Collapse-related helpers ---------- */

/**
 * Collapsed thickness in pixels.
 * Used for:
 *  - CSS flex-basis when collapsed
 *  - snap-to-collapse threshold (converted to weights)
 *  - tab-bar height reference
 */
const COLLAPSED_THICKNESS_PX = 32

const isCollapsed = computed(() => {
  const n = node.value
  if (n.type !== 'leaf') return false
  // explicit flag OR size 0 means "collapsed"
  return !!n.collapsed || (n.size ?? 0) === 0
})

const toggleCollapse = () => {
  const n = node.value
  if (n.type !== 'leaf') return

  if (isCollapsed.value) {
    // expand
    const restored = n.lastSize ?? 1
    node.value = { ...n, collapsed: false, size: restored }
  } else {
    // collapse
    const currentSize = n.size ?? 1
    node.value = { ...n, collapsed: true, lastSize: currentSize, size: 0 }
  }
}

/** When clicking a tab on a collapsed pane, expand & activate it */
const onCollapsedTabClick = (index: number) => {
  const n = node.value
  if (n.type !== 'leaf') return

  // first expand
  if (isCollapsed.value) {
    const restored = n.lastSize ?? 1
    node.value = {
      ...setActiveView({ ...n, collapsed: false, size: restored }, index),
    }
  } else {
    node.value = setActiveView(n, index)
  }
}

/* ---------- Layout-related computed ---------- */

/** Whether to show the tab header for this leaf node */
const showTabs = computed(() => {
  const n = node.value
  if (n.type !== 'leaf') return false

  // When collapsed we always show the header (even if showTabs is "never")
  if (isCollapsed.value) return true

  const mode = n.showTabs ?? 'always'
  const count = n.views?.length ?? 0

  if (mode === 'never') return false
  if (mode === 'always') return true
  // 'auto'
  return count > 1
})

/** Flex style respecting size / sizeMode */
const nodeStyle = computed(() => {
  const n = node.value
  const mode = n.sizeMode ?? 'weight'

  // Collapsed: fixed thickness (width in row, height in column) in pixels
  if (n.type === 'leaf' && isCollapsed.value) {
    const thickness = `${COLLAPSED_THICKNESS_PX}px`
    return { flex: `0 0 ${thickness}` }
  }

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

  // Convert collapsed thickness in px into a weight threshold
  const collapseWeightThreshold = (COLLAPSED_THICKNESS_PX / totalSize) * totalWeight

  node.value = resizeChildren(
    current,
    activeSplitterIndex.value,
    deltaWeight,
    collapseWeightThreshold,
  )
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

/* ---------- Splitter collapse helpers ---------- */

type SplitterSide = 'prev' | 'next'

const collapsePane = (splitterIndex: number, side: SplitterSide) => {
  const n = node.value
  if (n.type !== 'container' || !n.children) return

  const children = [...n.children]

  const targetIndex = side === 'prev' ? splitterIndex : splitterIndex + 1
  const neighborIndex = side === 'prev' ? splitterIndex + 1 : splitterIndex

  const target = children[targetIndex]
  const neighbor = children[neighborIndex]
  if (!target || !neighbor) return

  const targetSize = target.size ?? 1
  const neighborSize = neighbor.size ?? 1

  // If already collapsed, restore from lastSize
  if ((targetSize === 0 || target.collapsed) && target.lastSize != null) {
    const restored = target.lastSize
    const newNeighborSize = Math.max(neighborSize - restored, 0)

    children[targetIndex] = {
      ...target,
      collapsed: false,
      size: restored,
    }
    children[neighborIndex] = {
      ...neighbor,
      size: newNeighborSize,
    }

    node.value = { ...n, children }
    return
  }

  // Collapse this pane, give its space to the neighbor
  children[targetIndex] = {
    ...target,
    collapsed: true,
    lastSize: target.lastSize ?? targetSize,
    size: 0,
  }
  children[neighborIndex] = {
    ...neighbor,
    collapsed: false,
    size: neighborSize + targetSize,
  }

  node.value = { ...n, children }
}

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

/* ---------------- Splitter ---------------- */
.dock-splitter {
  position: relative;
  flex-shrink: 0;
  color: color-mix(in srgb, currentColor 15%, transparent);
  background: transparent;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.dock-splitter.row {
  width: 8px;
}

.dock-splitter.column {
  height: 8px;
}

.dock-splitter--enabled.row {
  cursor: col-resize;
}

.dock-splitter--enabled.column {
  cursor: row-resize;
}

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

/* Splitter arrow buttons (shown on hover) */
.dock-splitter-btn {
  position: absolute;
  z-index: 1;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: inherit;
  padding: 0;
  width: 28px; /* bigger click area */
  height: 28px; /* bigger click area */
  font-size: 14px; /* bigger symbol */
  display: flex;
  align-items: center;
  justify-content: center;

  opacity: 0;
  pointer-events: none;
  box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent);
  transition:
    opacity 0.15s ease,
    background-color 0.15s ease,
    transform 0.1s ease;
}

/* Show arrows only when splitter is hovered */
.dock-splitter--enabled:hover .dock-splitter-btn {
  opacity: 1;
  pointer-events: auto;
}

.dock-splitter-btn:hover {
  background: color-mix(in srgb, currentColor 22%, transparent);
  transform: scale(1.03);
}

/* Position for horizontal (row) splitters */
.dock-splitter.row .dock-splitter-btn--prev {
  top: 50%;
  left: 2px;
  transform: translate(-50%, -50%);
}
.dock-splitter.row .dock-splitter-btn--next {
  top: 50%;
  right: 2px;
  transform: translate(50%, -50%);
}

/* Position for vertical (column) splitters */
.dock-splitter.column .dock-splitter-btn--prev {
  left: 50%;
  top: 2px;
  transform: translate(-50%, -50%);
}
.dock-splitter.column .dock-splitter-btn--next {
  left: 50%;
  bottom: 2px;
  transform: translate(-50%, 50%);
}

/* ---------------- Tabs header (base) ---------------- */
.dock-tabs-header {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

/* Tabs */
.dock-tab {
  display: flex;
  flex-direction: row;
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

/* Minimize button: right edge in horizontal mode */
.dock-tab-minimize {
  margin-left: auto;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 0.25rem;
  flex-shrink: 0;
  font-size: 0.9rem;
  color: inherit;
}

/* Collapsed: header is the only visible part */
.dock-tabs-header--collapsed {
  flex-shrink: 0;
}

/* Remove borders when collapsed (both orientations) */
.dock-tabs-header.dock-tabs-header--collapsed {
  border-bottom: none;
}

.dock-tabs-header--vertical.dock-tabs-header--collapsed {
  border-right: none;
}

/* ---------------- Vertical strip (collapsed sidebar) ---------------- */
/*
  IMPORTANT:
  Header is a flex COLUMN so children stack vertically.
*/
.dock-tabs-header--vertical {
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch;
  justify-content: flex-start;

  overflow-x: hidden;
  overflow-y: auto;

  border-bottom: none;
  border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);

  padding: 0.25rem 0.15rem;
  gap: 0.15rem;
}

/* Make each tab fill the strip width and stack its content vertically */
.dock-tabs-header--vertical .dock-tab {
  width: 100%;
  padding: 0.5rem 0.25rem;

  display: flex;
  flex-direction: column; /* stack icon + title + close vertically */
  align-items: center; /* center them in the strip */
  justify-content: center;

  border-bottom: none;
  border-right: 2px solid transparent;

  /* ensure enough height for rotated text */
  min-height: 40px;
}

/* Highlight active tab in vertical strip */
.dock-tabs-header--vertical .dock-tab.active {
  border-right-color: currentColor;
}

/* Vertical text for the title: use rotation instead of writing-mode */
.dock-tabs-header--vertical .dock-tab-title {
  display: inline-block;
  transform: rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
  line-height: 1.1;
  text-align: center;
  max-width: 8rem; /* prevent very long titles taking too much space */
}

/* Icon spacing in vertical strip */
.dock-tabs-header--vertical .dock-tab-icon {
  margin-right: 0;
  margin-bottom: 0.25rem;
}

/* Close button layout in vertical strip */
.dock-tabs-header--vertical .dock-tab-close {
  margin-left: 0;
  margin-top: 0.25rem;
}

/* '+' in vertical strip */
.dock-tabs-header--vertical .dock-tab-add {
  margin-left: 0;
  margin-top: 0.25rem;
  align-self: center;
}

/* Minimize goes to the bottom in vertical strip */
.dock-tabs-header--vertical .dock-tab-minimize {
  margin-left: 0;
  margin-top: auto; /* push to bottom */
  align-self: center;
}

/* ---------------- Content ---------------- */
.dock-content {
  min-width: 0;
  min-height: 0;
}

.dock-content--content {
  flex: 0 0 auto;
  overflow: visible;
}

.dock-content--weight {
  position: relative;
  flex: 1 1 0;
  overflow: hidden;
}

.dock-content-inner {
  position: absolute;
  inset: 0;
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

.dock-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
