<!-- DockView.vue -->
<template>
  <div
    ref="containerRef"
    class="dock-node"
    :class="{
      'dock-row': node.type === 'container' && node.direction === 'row',
      'dock-col': node.type === 'container' && node.direction === 'column',
      'dock-resizing': isResizing,
      'dock-node--tabs-left': isLeftTabsLayout,
    }"
    :style="nodeStyle"
  >
    <!-- Tabs header: always shown if showTabs, even when collapsed -->
    <div
      v-if="showTabs || isCollapsed"
      class="dock-tabs-header"
      :class="{
        'dock-tabs-header--vertical': isCollapsed && parentDirection === 'row',
        'dock-tabs-header--collapsed': isCollapsed,
        'dock-tabs-header--left': isLeftTabsLayout,
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
        :data-cy="`dock-tab-${node.id}-${viewId}`"
        :class="[
          tabClass,
          { active: index === (node.activeViewIndex ?? 0) },
          index === (node.activeViewIndex ?? 0) && activeTabClass,
        ]"
        @click="isCollapsed ? onCollapsedTabClick(index) : onTabClick(index)"
      >
        <q-icon v-if="tabIcons?.[viewId]" class="dock-tab-icon" :name="tabIcons[viewId]" />
        <span
          class="dock-tab-title"
          :title="tabTitleTooltips?.[viewId] || tabTitles?.[viewId] || viewId"
          >{{ tabTitles?.[viewId] || viewId }}</span
        >

        <button
          v-if="!hideTabClose && !isCollapsed && !pinnedViews.includes(viewId)"
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
        :data-cy="`dock-minimize-${node.id}`"
        type="button"
        :class="tabButtonClass"
        @click.stop="toggleCollapse"
      >
        {{ isCollapsed ? '▢' : '▁' }}
      </button>
    </div>

    <!-- Container Node -->
    <template v-if="node.type === 'container' && node.children && node.children.length">
      <template v-for="(child, index) in node.children" :key="child.id">
        <DockView
          v-model:node="node.children![index]!"
          :parent-direction="node.direction"
          :hide-tab-add="hideTabAdd"
          :hide-tab-close="hideTabClose"
          :pinned-views="pinnedViews"
          :tab-class="tabClass"
          :active-tab-class="activeTabClass"
          :tab-button-class="tabButtonClass"
          :add-button-class="addButtonClass"
          :tab-icons="tabIcons"
          :tab-titles="tabTitles"
          :tab-title-tooltips="tabTitleTooltips"
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
          :class="[node.direction, getSplitterSnapClass(index)]"
          :title="getSplitterTitle(index)"
          @mousedown="startResize(index, $event)"
          @dblclick.stop="onSplitterDoubleClick(index)"
        >
          <div class="dock-splitter-controls" @mousedown.stop>
            <button
              class="dock-splitter-toggle"
              type="button"
              :title="getSplitterSideTitle(index, 'left')"
              :data-cy="`dock-splitter-toggle-left-${node.id}-${index}`"
              @click.stop="toggleChildCollapsedFromSplitter(index, 'left')"
            >
              {{ getSplitterSideToggleLabel(index, 'left') }}
            </button>
            <button
              class="dock-splitter-toggle"
              type="button"
              :title="getSplitterSideTitle(index, 'right')"
              :data-cy="`dock-splitter-toggle-right-${node.id}-${index}`"
              @click.stop="toggleChildCollapsedFromSplitter(index, 'right')"
            >
              {{ getSplitterSideToggleLabel(index, 'right') }}
            </button>
          </div>
          <div
            v-if="isResizing && activeSplitterIndex === index && getSplitterSnapHintLabel(index)"
            class="dock-splitter-hint"
          >
            {{ getSplitterSnapHintLabel(index) }}
          </div>
        </div>
      </template>
    </template>

    <!-- Leaf Node (Tabs) -->
    <template v-else-if="node.type === 'leaf'">
      <template v-if="shouldRenderLeafContent">
        <!-- Content-sized leaves -->
        <div v-if="isContentSizedLeaf" class="dock-content dock-content--content">
          <template v-if="node.views && node.views.length > 0">
            <template v-for="(viewId, index) in node.views" :key="viewId">
              <div
                v-if="shouldMountView(viewId, index)"
                v-show="isViewVisible(index)"
                class="dock-view-host"
                :data-cy="`dock-view-${node.id}-${viewId}`"
              >
                <slot :name="viewId" />
              </div>
            </template>
          </template>
          <div v-else class="dock-empty">No Views</div>
        </div>

        <!-- Weight-based leaves -->
        <div v-else class="dock-content dock-content--weight">
          <div class="dock-content-inner">
            <template v-if="node.views && node.views.length > 0">
              <template v-for="(viewId, index) in node.views" :key="viewId">
                <div
                  v-if="shouldMountView(viewId, index)"
                  v-show="isViewVisible(index)"
                  class="dock-view-host"
                  :data-cy="`dock-view-${node.id}-${viewId}`"
                >
                  <slot :name="viewId" />
                </div>
              </template>
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
  /** view ids that must stay mounted even when not active/collapsed */
  keepAliveViews?: string[]
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
  pinnedViews = [],

  // these can be whatever you like – empty string / undefined / {}
  tabClass = '',
  activeTabClass = '',
  tabButtonClass = '',
  addButtonClass = '',
  tabIcons = {},
  tabTitles = {},
  tabTitleTooltips = {},
  tabPosition = 'top',
} = defineProps<{
  parentDirection?: DockDirection | undefined

  /** Show the "x" close button on each tab (default: true) */
  hideTabClose?: boolean
  /** Show the "+" add-tab button (default: true) */
  hideTabAdd?: boolean
  /** View ids that remain present when other tabs are closable. */
  pinnedViews?: string[]

  /** Extra CSS classes for easier styling from parent */
  tabClass?: string
  activeTabClass?: string
  tabButtonClass?: string
  addButtonClass?: string

  /** Map viewId -> raw SVG string (trusted HTML) for tab icons */
  tabIcons?: Record<string, string>
  /** Map viewId -> display title */
  tabTitles?: Record<string, string>
  /** Map viewId -> title tooltip */
  tabTitleTooltips?: Record<string, string>
  /** position of tab header in leaf nodes */
  tabPosition?: 'top' | 'left'
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

const isNodeCollapsed = (n: DockNode): boolean => n.collapsed === true || (n.size ?? 0) <= 0

const getContainerPixelSize = (): number => {
  if (!containerRef.value || node.value.type !== 'container' || !node.value.direction) return 0
  const rect = containerRef.value.getBoundingClientRect()
  return node.value.direction === 'row' ? rect.width : rect.height
}

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
  restoreWeightThreshold: number,
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
      lastSize: Math.max(left.lastSize ?? leftSize, restoreWeightThreshold),
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
      lastSize: Math.max(right.lastSize ?? rightSize, restoreWeightThreshold),
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
const MIN_RESTORE_THICKNESS_PX = 220
const MIN_RESTORE_WEIGHT = 20

const getLeafRestoreSize = (n: DockNode): number =>
  Math.max(n.lastSize ?? MIN_RESTORE_WEIGHT, MIN_RESTORE_WEIGHT)

const isCollapsed = computed(() => {
  const n = node.value
  if (n.type !== 'leaf') return false
  return n.collapsed === true || n.size === 0
})

const isLeftTabsLayout = computed(
  () => node.value.type === 'leaf' && tabPosition === 'left' && !isCollapsed.value,
)

const toggleCollapse = () => {
  const n = node.value
  if (n.type !== 'leaf') return

  if (isCollapsed.value) {
    // expand
    const restored = getLeafRestoreSize(n)
    node.value = { ...n, collapsed: false, size: restored }
  } else {
    // collapse
    const currentSize = n.size ?? 1
    node.value = {
      ...n,
      collapsed: true,
      lastSize: Math.max(currentSize, MIN_RESTORE_WEIGHT),
      size: 0,
    }
  }
}

/** When clicking a tab on a collapsed pane, expand & activate it */
const onCollapsedTabClick = (index: number) => {
  const n = node.value
  if (n.type !== 'leaf') return

  // first expand
  if (isCollapsed.value) {
    const restored = getLeafRestoreSize(n)
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
  if (node.value.type === 'container') return false
  const mode = node.value.showTabs ?? 'always'
  if (mode === 'never') return false
  if (mode === 'always') return true
  // 'auto'
  const count = node.value.views?.length ?? 0
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
const snapSide = ref<'left' | 'right' | null>(null)

const isContentSizedLeaf = computed(
  () => node.value.type === 'leaf' && (node.value.sizeMode ?? 'weight') === 'content',
)

const isKeepAliveView = (viewId: string): boolean => {
  const n = node.value
  if (n.type !== 'leaf') return false
  return (n.keepAliveViews ?? []).includes(viewId)
}

const isViewVisible = (index: number): boolean =>
  !isCollapsed.value && index === (node.value.activeViewIndex ?? 0)

const shouldMountView = (viewId: string, index: number): boolean => {
  if (node.value.type !== 'leaf') return false
  const isActive = index === (node.value.activeViewIndex ?? 0)
  return (!isCollapsed.value && isActive) || isKeepAliveView(viewId)
}

const shouldRenderLeafContent = computed(() => {
  if (node.value.type !== 'leaf') return false
  if (!isCollapsed.value) return true
  const views = node.value.views ?? []
  return views.some((viewId) => isKeepAliveView(viewId))
})

const getSplitterSnapSide = (
  leftSize: number,
  rightSize: number,
  deltaWeight: number,
  collapseWeightThreshold: number,
): 'left' | 'right' | null => {
  const newLeft = Math.max(0, leftSize + deltaWeight)
  const newRight = Math.max(0, rightSize - deltaWeight)
  if (newLeft < collapseWeightThreshold) return 'left'
  if (newRight < collapseWeightThreshold) return 'right'
  return null
}

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
  const restoreWeightThreshold = (MIN_RESTORE_THICKNESS_PX / totalSize) * totalWeight

  const left = current.children[activeSplitterIndex.value]
  const right = current.children[activeSplitterIndex.value + 1]
  if (left && right) {
    snapSide.value = getSplitterSnapSide(
      left.size ?? 1,
      right.size ?? 1,
      deltaWeight,
      collapseWeightThreshold,
    )
  } else {
    snapSide.value = null
  }

  node.value = resizeChildren(
    current,
    activeSplitterIndex.value,
    deltaWeight,
    collapseWeightThreshold,
    restoreWeightThreshold,
  )
}

const stopResize = () => {
  if (!isResizing.value) return
  isResizing.value = false
  activeSplitterIndex.value = -1
  snapSide.value = null
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

const toggleChildCollapsedFromSplitter = (splitterIndex: number, side: 'left' | 'right') => {
  const current = node.value
  if (current.type !== 'container' || !current.children) return

  const left = current.children[splitterIndex]
  const right = current.children[splitterIndex + 1]
  if (!left || !right) return

  const pixelSize = getContainerPixelSize()
  const pairTotal = (left.size ?? 1) + (right.size ?? 1)
  const totalWeight = current.children.reduce((acc, child) => acc + (child.size ?? 1), 0)
  const collapseWeightThreshold =
    pixelSize > 0 ? (COLLAPSED_THICKNESS_PX / pixelSize) * totalWeight : 1
  const restoreWeightThreshold =
    pixelSize > 0 ? (MIN_RESTORE_THICKNESS_PX / pixelSize) * totalWeight : MIN_RESTORE_WEIGHT

  const target = side === 'left' ? left : right
  const other = side === 'left' ? right : left
  const targetCollapsed = isNodeCollapsed(target)

  if (targetCollapsed) {
    const wanted = Math.max(target.lastSize ?? restoreWeightThreshold, restoreWeightThreshold)
    const maxAllowed = Math.max(collapseWeightThreshold, pairTotal - collapseWeightThreshold)
    const restored = clamp(wanted, collapseWeightThreshold, maxAllowed)
    const otherSize = Math.max(collapseWeightThreshold, pairTotal - restored)

    const children = [...current.children]
    if (side === 'left') {
      children[splitterIndex] = { ...target, collapsed: false, size: restored }
      children[splitterIndex + 1] = { ...other, collapsed: false, size: otherSize }
    } else {
      children[splitterIndex] = { ...other, collapsed: false, size: otherSize }
      children[splitterIndex + 1] = { ...target, collapsed: false, size: restored }
    }
    node.value = { ...current, children }
    return
  }

  const children = [...current.children]
  if (side === 'left') {
    children[splitterIndex] = {
      ...target,
      collapsed: true,
      lastSize: Math.max(target.lastSize ?? target.size ?? 1, restoreWeightThreshold),
      size: 0,
    }
    children[splitterIndex + 1] = { ...other, collapsed: false, size: pairTotal }
  } else {
    children[splitterIndex] = { ...other, collapsed: false, size: pairTotal }
    children[splitterIndex + 1] = {
      ...target,
      collapsed: true,
      lastSize: Math.max(target.lastSize ?? target.size ?? 1, restoreWeightThreshold),
      size: 0,
    }
  }
  node.value = { ...current, children }
}

const onSplitterDoubleClick = (splitterIndex: number) => {
  toggleChildCollapsedFromSplitter(splitterIndex, 'right')
}

const getSplitterTitle = (splitterIndex: number): string => {
  const current = node.value
  if (current.type !== 'container' || !current.children) return ''
  const right = current.children[splitterIndex + 1]
  if (!right) return ''
  return isNodeCollapsed(right) ? 'Restore panel' : 'Minimize panel'
}

const getSplitterSideToggleLabel = (splitterIndex: number, side: 'left' | 'right'): string => {
  const current = node.value
  if (current.type !== 'container' || !current.children || !current.direction) return '◂'
  const left = current.children[splitterIndex]
  const right = current.children[splitterIndex + 1]
  const target = side === 'left' ? left : right
  if (!target) return side === 'left' ? '◂' : '▸'
  const collapsed = isNodeCollapsed(target)

  if (current.direction === 'row') {
    if (side === 'left') return collapsed ? '▸' : '◂'
    return collapsed ? '◂' : '▸'
  }

  if (side === 'left') return collapsed ? '▾' : '▴'
  return collapsed ? '▴' : '▾'
}

const getSplitterSideTitle = (splitterIndex: number, side: 'left' | 'right'): string => {
  const current = node.value
  if (current.type !== 'container' || !current.children || !current.direction) return ''
  const target =
    side === 'left' ? current.children[splitterIndex] : current.children[splitterIndex + 1]
  if (!target) return ''
  const collapsed = isNodeCollapsed(target)
  const axis =
    current.direction === 'row'
      ? side === 'left'
        ? 'left'
        : 'right'
      : side === 'left'
        ? 'top'
        : 'bottom'
  return collapsed ? `Restore ${axis} pane` : `Minimize ${axis} pane`
}

const getSplitterSnapClass = (splitterIndex: number): string => {
  if (!isResizing.value || activeSplitterIndex.value !== splitterIndex || !snapSide.value) return ''
  return snapSide.value === 'left' ? 'dock-splitter--snap-left' : 'dock-splitter--snap-right'
}

const getSplitterSnapHintLabel = (splitterIndex: number): string => {
  if (!isResizing.value || activeSplitterIndex.value !== splitterIndex || !snapSide.value) return ''
  const current = node.value
  if (current.type !== 'container' || !current.direction) return ''
  if (current.direction === 'row') {
    return snapSide.value === 'left'
      ? 'Release to collapse left pane'
      : 'Release to collapse right pane'
  }
  return snapSide.value === 'left'
    ? 'Release to collapse top pane'
    : 'Release to collapse bottom pane'
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
  flex-direction: column;

  /*we do this to not loose the mouse grab when dragging an iframe split view*/
  &.dock-resizing :deep(iframe) {
    pointer-events: none !important;
  }

  &.dock-row {
    flex-direction: row;
  }

  &.dock-node--tabs-left {
    flex-direction: row;
  }
}

/* Splitter */
.dock-splitter {
  position: relative;
  flex-shrink: 0;
  /* very subtle by default */
  color: color-mix(in srgb, currentColor 15%, transparent);
  background: transparent;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  /* Hover: stronger color, slight background, thicker line – only when enabled */
  &:hover {
    color: color-mix(in srgb, currentColor 45%, transparent);
    background-color: color-mix(in srgb, currentColor 4%, transparent);
  }

  &::before {
    content: '';
    position: absolute;
    background-color: currentColor;
    border-radius: 999px;
    transition:
      background-color 0.15s ease,
      width 0.15s ease,
      height 0.15s ease;
  }

  /* Horizontal split (vertical splitter line) */
  &.row {
    width: 8px;
    cursor: col-resize;
    &:hover::before {
      width: 4px;
    }
    &::before {
      width: 2px;
      top: 4px;
      bottom: 4px;
      left: 50%;
      transform: translateX(-50%);
    }
  }

  /* Vertical split (horizontal splitter line) */
  &.column {
    height: 8px;
    cursor: row-resize;
    &:hover::before {
      height: 4px;
    }
    &::before {
      height: 2px;
      left: 4px;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
    }
  }

  &.dock-splitter--snap-left,
  &.dock-splitter--snap-right {
    color: color-mix(in srgb, currentColor 80%, transparent);
    background-color: color-mix(in srgb, currentColor 10%, transparent);
  }
}

.dock-splitter-controls {
  position: absolute;
  top: 38.2%;
  left: 50%;
  z-index: 2;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.dock-splitter:hover .dock-splitter-controls,
.dock-splitter:focus-within .dock-splitter-controls,
.dock-splitter-controls:hover {
  opacity: 1;
}

.dock-splitter-toggle {
  width: 14px;
  height: 14px;
  z-index: 2;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  background: rgba(30, 30, 30, 0.55);
  color: white;
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    opacity 0.16s ease,
    filter 0.16s ease;
}

.dock-splitter-toggle:hover {
  opacity: 1;
  filter: brightness(1.12);
  background: rgba(30, 30, 30, 0.75);
  border-color: rgba(255, 255, 255, 0.85);
  color: white;
}

.dock-splitter-hint {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.2;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, black 86%, transparent);
  color: white;
}

.dock-splitter.row .dock-splitter-hint {
  top: 50%;
  left: 100%;
  transform: translate(6px, -50%);
}

.dock-splitter.column .dock-splitter-hint {
  top: 100%;
  left: 50%;
  transform: translate(-50%, 6px);
}

/* Tabs header */
.dock-tabs-header {
  display: flex;
  flex-shrink: 0;
  flex-direction: row;
  overflow-x: auto;
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  /* background: color-mix(in srgb, currentColor 2%, transparent); */

  /* Remove borders when collapsed (both orientations) */
  &.dock-tabs-header--collapsed {
    border-bottom: none;
  }

  /* ---------- Vertical collapsed strip ---------- */
  /* When collapsed in a row container: vertical strip */
  &.dock-tabs-header--vertical {
    text-orientation: mixed;
    flex-direction: column; /* stack items (tabs, +, minimize) vertically */
    align-items: stretch;
    border-bottom: none;
    border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    overflow-x: visible; /* vertical layout: scroll vertically, not horizontally */
    overflow-y: auto;
    padding-block: 0.25rem; /* Optional: a bit of padding */
  }

  &.dock-tabs-header--left {
    text-orientation: mixed;
    flex-direction: column;
    align-items: stretch;
    border-bottom: none;
    border-right: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    overflow-x: visible;
    overflow-y: auto;
    min-width: 132px;
    padding-block: 0.25rem;
  }
}

/* Individual tab */
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

  &:hover {
    background: color-mix(in srgb, currentColor 4%, transparent);
  }

  &.active {
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
}

/* Tabs within the vertical strip:
   - make tab contents (icon, title, close) vertical as well */
.dock-tabs-header--vertical .dock-tab {
  padding: 0.75rem 0.25rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-bottom: none;
  border-right: 2px solid transparent;

  &.active {
    font-weight: inherit;
    border-bottom-color: inherit;
    background: inherit;
  }

  &:hover {
    background: color-mix(in srgb, currentColor 4%, transparent);
  }

  .dock-tab-title {
    flex: 0 0 auto; /* key fix: stop flex:1 from collapsing height */
    min-width: unset; /* horizontal rule not meaningful here */
    min-height: 0;
    display: inline-block;

    /* Make the text actually vertical */
    writing-mode: vertical-rl; /* use this (more widely supported) */
    text-orientation: mixed; /* latin reads sideways, not stacked upright */

    /* Use logical sizing instead of max-height (axes swap in vertical writing) */
    max-inline-size: 6rem; /* limits “length” of the vertical label (physical height) */
    overflow: hidden;

    /* optional spacing similar to horizontal tab */
    margin-top: 0.25rem;
  }

  .dock-tab-close {
    margin-left: 0;
    margin-top: 0.25rem;
  }
}

.dock-tabs-header--left .dock-tab {
  border-bottom: none;
  border-right: 2px solid transparent;
  padding: 0.35rem 0.6rem;
}

.dock-tabs-header--left .dock-tab.active {
  border-right-color: currentColor;
}

.dock-tabs-header--left .dock-tab-close {
  margin-left: auto;
}

.dock-tabs-header--left .dock-tab-add,
.dock-tabs-header--left .dock-tab-minimize {
  margin-left: 0;
  margin-top: 0.25rem;
  align-self: center;
}

/* Close and Add buttons inside tabs/header */
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

.dock-tabs-header--vertical .dock-tab-add,
.dock-tabs-header--vertical .dock-tab-minimize {
  margin-left: 0;
  margin-top: 0.25rem;
  align-self: center;
}

/* Minimize button styling */
.dock-tab-minimize {
  margin-left: auto; /* pushes it to the far right in horizontal layout */
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 0.25rem;
  flex-shrink: 0;
  font-size: 0.9rem;
  color: inherit;
}

/* Content */
/* Base: shared bits */
.dock-content {
  min-width: 0;
  min-height: 0;

  /* Absolute inner scroller ONLY for weight-based leaves */
  .dock-content-inner {
    position: absolute;
    inset: 0;
    overflow: auto;
    min-width: 0;
    min-height: 0;

    /* Optional: make "No Views" fill the available area in weight-based leaves.
   For content leaves, you typically won't hit .dock-empty anyway. */
    .dock-empty {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
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

.dock-view-host {
  min-width: 0;
  min-height: 0;
}

.dock-content--weight .dock-view-host {
  width: 100%;
  height: 100%;
}
</style>
