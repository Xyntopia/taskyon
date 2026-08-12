<!-- DockView.vue -->
<template>
  <div
    ref="containerRef"
    class="dock-node"
    :class="{
      'dock-row': node.type === 'container' && node.direction === 'row',
      'dock-col': node.type === 'container' && node.direction === 'column',
      'dock-resizing': isResizing,
      'dock-node--tabs-left': isLeftTabsLayout && !controlsOnly,
      'dock-node--container': node.type === 'container',
      'dock-node--leaf': node.type === 'leaf',
      'dock-node--animated': node.animateTransitions === true,
      'dock-dragging': isDocking,
    }"
    :data-dock-node-id="node.id"
    :data-dock-region="node.region"
    :style="nodeStyle"
  >
    <button
      v-if="node.type === 'leaf' && (showPaneControls || isCollapsed) && !managedAutoHiddenViewId"
      class="dock-pane-toggle"
      :data-cy="`dock-minimize-${node.id}`"
      type="button"
      :class="tabButtonClass"
      :title="isCollapsed ? 'Restore pane' : 'Minimize pane'"
      :aria-label="isCollapsed ? 'Restore pane' : 'Minimize pane'"
      @click.stop="toggleCollapse"
    >
      <q-icon :name="isCollapsed ? matOpenInFull : matCloseFullscreen" />
    </button>

    <div
      v-if="showTabHeader || isCollapsed"
      class="dock-tabs-header"
      :data-cy="`dock-tabs-header-${node.id}`"
      role="tablist"
      :class="{
        'dock-tabs-header--vertical': isCollapsed && parentDirection === 'row',
        'dock-tabs-header--collapsed': isCollapsed,
        'dock-tabs-header--left': isLeftTabsLayout && !controlsOnly,
        'dock-tabs-header--compact': isCompactTabRail,
        'dock-tabs-header--smart': smartTabsEnabled,
        'dock-tabs-header--controls-only': controlsOnly,
        'dock-tabs-header--drop-empty': isTabHeaderDropTarget && (node.views?.length ?? 0) === 0,
      }"
      @dragover="onTabHeaderDragOver"
      @drop="onTabHeaderDrop"
    >
      <button
        v-if="isTabRailCollapsible"
        class="dock-tab-rail-toggle"
        :data-cy="`dock-tab-rail-toggle-${node.id}`"
        type="button"
        :class="tabButtonClass"
        :title="isCompactTabRail ? 'Expand tab navigation' : 'Compact tab navigation'"
        :aria-label="isCompactTabRail ? 'Expand tab navigation' : 'Compact tab navigation'"
        @click.stop="toggleTabRail"
      >
        <q-icon :name="isCompactTabRail ? mdiChevronDoubleRight : mdiChevronDoubleLeft" />
      </button>

      <!-- Plus button still available when not collapsed -->
      <button
        v-if="!hideTabAdd && !isCollapsed"
        class="dock-tab-add"
        :data-cy="`dock-add-${node.id}`"
        type="button"
        :class="addButtonClass"
        @click.stop="onAddTabClick"
      >
        +
      </button>
      <q-menu v-if="addViewOptions !== undefined" v-model="showAddViewMenu" no-parent-event>
        <q-list dense class="dock-add-menu">
          <q-item tag="label">
            <q-item-section>Hide tab when alone</q-item-section>
            <q-item-section side>
              <q-toggle
                :model-value="node.type === 'leaf' && node.showTabs === 'auto'"
                aria-label="Hide tab when alone"
                @update:model-value="setAutoHideSingleTab"
              />
            </q-item-section>
          </q-item>
          <q-item tag="label">
            <q-item-section>Smart tabs</q-item-section>
            <q-item-section side>
              <q-toggle
                :model-value="node.type === 'leaf' && node.tabLayout === 'smart'"
                aria-label="Wrap tabs into up to three rows"
                @update:model-value="setSmartTabs"
              />
            </q-item-section>
          </q-item>
          <q-item tag="label">
            <q-item-section>Vertical tab bar</q-item-section>
            <q-item-section side>
              <q-toggle
                :model-value="resolvedTabPosition === 'left'"
                aria-label="Place tabs vertically on the left"
                @update:model-value="setVerticalTabs"
              />
            </q-item-section>
          </q-item>
          <q-separator />
          <q-item>
            <q-item-section>
              <q-input
                v-model="addViewQuery"
                dense
                outlined
                clearable
                placeholder="Search panes"
                aria-label="Search panes"
              >
                <template #prepend><q-icon :name="matSearch" /></template>
              </q-input>
            </q-item-section>
          </q-item>
          <q-item
            v-for="option in filteredAddViewOptions"
            :key="option.id"
            v-close-popup
            clickable
            :data-cy="`dock-add-option-${node.id}-${option.id}`"
            @click="onAddViewOptionClick(option)"
          >
            <q-item-section v-if="option.icon" avatar>
              <q-icon :name="option.icon" />
            </q-item-section>
            <q-item-section>{{ option.label }}</q-item-section>
            <q-item-section side>
              <q-btn
                flat
                round
                dense
                icon="splitscreen"
                :aria-label="`Split ${option.label}`"
                @click.stop
              >
                <q-menu anchor="top end" self="top start">
                  <q-list dense role="menu">
                    <q-item
                      v-for="placement in splitPlacements"
                      :key="placement.position"
                      v-close-popup="2"
                      clickable
                      role="menuitem"
                      @click.stop="onAddViewOptionClick(option, placement.position)"
                    >
                      <q-item-section avatar>
                        <q-icon :name="placement.icon" />
                      </q-item-section>
                      <q-item-section>{{ placement.label }}</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </q-item-section>
          </q-item>
          <q-item v-if="filteredAddViewOptions.length === 0">
            <q-item-section class="text-caption">No matching panes.</q-item-section>
          </q-item>
        </q-list>
      </q-menu>

      <template v-for="(viewId, index) in node.views || []" :key="viewId">
        <div
          v-if="showTabItems || isCollapsed"
          class="dock-tab"
          :data-cy="`dock-tab-${node.id}-${viewId}`"
          :data-leaf-id="node.id"
          :data-tab-index="index"
          :data-view-id="viewId"
          :draggable="canDragView(viewId)"
          :class="[
            tabClass,
            { active: index === (node.activeViewIndex ?? 0) },
            index === (node.activeViewIndex ?? 0) && activeTabClass,
            getTabDropClass(index),
          ]"
          role="tab"
          tabindex="0"
          :aria-label="tabTitles?.[viewId] || viewId"
          :aria-selected="index === (node.activeViewIndex ?? 0)"
          @click="isCollapsed ? onCollapsedTabClick(index) : onTabClick(index)"
          @keydown.enter.prevent="isCollapsed ? onCollapsedTabClick(index) : onTabClick(index)"
          @keydown.space.prevent="isCollapsed ? onCollapsedTabClick(index) : onTabClick(index)"
          @dragstart="onTabDragStart($event, viewId, index)"
          @dragover="onTabDragOver($event, index)"
          @drop="onTabDrop($event, index)"
          @dragend="stopTabDrag"
        >
          <q-icon v-if="tabIcons?.[viewId]" class="dock-tab-icon" :name="tabIcons[viewId]" />
          <span
            class="dock-tab-title"
            :title="tabTitleTooltips?.[viewId] || tabTitles?.[viewId] || viewId"
            >{{ tabTitles?.[viewId] || viewId }}</span
          >

          <div class="dock-tab-drag-image" aria-hidden="true">
            <q-icon v-if="tabIcons?.[viewId]" class="dock-tab-icon" :name="tabIcons[viewId]" />
            <span>{{ tabTitles?.[viewId] || viewId }}</span>
          </div>

          <button
            v-if="!hideTabClose && !isCollapsed && !pinnedViews.includes(viewId)"
            class="dock-tab-close"
            :data-cy="`dock-close-${node.id}-${viewId}`"
            type="button"
            :class="tabButtonClass"
            @click.stop="onTabClose(viewId)"
          >
            ×
          </button>
        </div>
      </template>
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
          :tab-position="tabPosition"
          :enable-tab-docking="enableTabDocking"
          :reveal-auto-hidden-tab="revealAutoHiddenTab"
          :can-dock-view="canDockView"
          :add-view-options="addViewOptions"
          :dock-root-controller="dockRoot"
          @add-view="onChildAddView"
          @view-activated="onChildViewActivated"
        >
          <!-- Forward all slots -->
          <template
            v-for="(_, slotName) in enableTabDocking ? {} : $slots"
            :key="slotName"
            #[slotName]="slotProps"
          >
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
            <template v-for="side in splitterSides" :key="side">
              <button
                class="dock-splitter-toggle"
                type="button"
                :title="getSplitterSideTitle(index, side)"
                :data-cy="`dock-splitter-toggle-${side}-${node.id}-${index}`"
                @click.stop="toggleChildCollapsedFromSplitter(index, side)"
              >
                {{ getSplitterSideToggleLabel(index, side) }}
              </button>
              <div v-if="getSplitterHiddenTab(index, side)" class="dock-splitter-tab-menu">
                <button
                  class="dock-splitter-tab-menu-trigger"
                  type="button"
                  draggable="true"
                  :title="`Actions for ${getSplitterHiddenTabTitle(index, side)}; drag to move`"
                  :aria-label="`Actions for hidden tab ${getSplitterHiddenTabTitle(index, side)}; drag to move`"
                  @dragstart="onSplitterTabDragStart($event, index, side)"
                  @dragend="stopTabDrag"
                >
                  <q-icon name="more_horiz" />
                  <span class="dock-tab-drag-image" aria-hidden="true">
                    {{ getSplitterHiddenTabTitle(index, side) }}
                  </span>
                </button>
                <q-menu>
                  <q-list dense class="dock-hidden-tab-menu">
                    <q-item-label header>
                      {{ getSplitterHiddenTabTitle(index, side) }}
                    </q-item-label>
                    <q-item v-close-popup clickable @click="showSplitterHiddenTab(index, side)">
                      <q-item-section avatar><q-icon name="tab" /></q-item-section>
                      <q-item-section>Show tab bar</q-item-section>
                    </q-item>
                    <template v-if="canCloseSplitterHiddenTab(index, side)">
                      <q-separator />
                      <q-item
                        v-close-popup
                        clickable
                        class="text-negative"
                        @click="closeSplitterHiddenTab(index, side)"
                      >
                        <q-item-section avatar><q-icon name="close" /></q-item-section>
                        <q-item-section>Close tab</q-item-section>
                      </q-item>
                    </template>
                  </q-list>
                </q-menu>
              </div>
            </template>
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
        <div
          v-if="isContentSizedLeaf"
          class="dock-content dock-content--content"
          :data-cy="`dock-content-${node.id}`"
          @dragover="onContentDragOver"
          @drop="onContentDrop"
        >
          <div
            v-if="contentDropPosition"
            class="dock-drop-preview"
            :class="`dock-drop-preview--${contentDropPosition}`"
            :data-cy="`dock-drop-preview-${node.id}`"
            :data-dock-position="contentDropPosition"
          />
          <template v-if="node.views && node.views.length > 0">
            <template v-for="(viewId, index) in node.views" :key="viewId">
              <div
                v-if="shouldMountView(viewId, index)"
                v-show="isViewVisible(index)"
                :id="getViewHostId(node.id, viewId)"
                :ref="(element) => registerViewHost(viewId, element)"
                class="dock-view-host"
                :data-cy="`dock-view-${node.id}-${viewId}`"
              >
                <slot v-if="!enableTabDocking" :name="viewId" />
              </div>
            </template>
          </template>
          <div v-else class="dock-empty">No Views</div>
        </div>

        <!-- Weight-based leaves -->
        <div
          v-else
          class="dock-content dock-content--weight"
          :data-cy="`dock-content-${node.id}`"
          @dragover="onContentDragOver"
          @drop="onContentDrop"
        >
          <div
            v-if="contentDropPosition"
            class="dock-drop-preview"
            :class="`dock-drop-preview--${contentDropPosition}`"
            :data-cy="`dock-drop-preview-${node.id}`"
            :data-dock-position="contentDropPosition"
          />
          <div class="dock-content-inner">
            <template v-if="node.views && node.views.length > 0">
              <template v-for="(viewId, index) in node.views" :key="viewId">
                <div
                  v-if="shouldMountView(viewId, index)"
                  v-show="isViewVisible(index)"
                  :id="getViewHostId(node.id, viewId)"
                  :ref="(element) => registerViewHost(viewId, element)"
                  class="dock-view-host"
                  :data-cy="`dock-view-${node.id}-${viewId}`"
                >
                  <slot v-if="!enableTabDocking" :name="viewId" />
                </div>
              </template>
            </template>
            <div v-else class="dock-empty">No Views</div>
          </div>
        </div>
      </template>
    </template>

    <template v-if="isDockRoot && enableTabDocking">
      <Teleport
        v-for="target in mountedViewTargets"
        :key="target.viewId"
        defer
        :to="target.element"
      >
        <slot :name="target.viewId" />
      </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { matCloseFullscreen, matOpenInFull, matSearch } from '@quasar/extras/material-icons'
import { mdiChevronDoubleLeft, mdiChevronDoubleRight } from '@quasar/extras/mdi-v6'
import { computed, onUnmounted, ref, shallowRef, useId, useSlots, type Ref } from 'vue'
import {
  addViewToLeaf,
  applyDockDrop,
  clamp,
  closeDockView,
  findLeaf,
  getLeafRestoreSize,
  MIN_RESTORE_WEIGHT,
  splitDockView,
  updateLeaf,
  viewIds,
  type DockNode,
  type DockPosition,
  type DockViewDropContext,
} from './dockLayout'

export interface DockViewAddOption {
  id: string
  label: string
  icon?: string
  viewId?: string
}

export interface AddViewContext {
  leafId: string
  position: DockPosition
  currentViews: string[]
  availableViewTypes: string[]
  selectedOptionId?: string
}

export interface AddViewResult {
  viewId: string
  makeActive?: boolean
}

export interface ViewActivatedContext {
  leafId: string
  viewId: string
  index: number
}

export type AddViewDone = (result: AddViewResult | null | undefined) => void

interface DockDragState {
  viewId: string
  sourceLeafId: string
  sourceIndex: number
}

interface DockDropPreview {
  targetLeafId: string
  targetIndex?: number
  position: DockPosition
}

interface DockRootController {
  id: string
  node: Ref<DockNode>
  drag: Ref<DockDragState | null>
  preview: Ref<DockDropPreview | null>
  viewHosts: Ref<ReadonlyMap<string, HTMLElement>>
  availableViewTypes: string[]
  emitDocked: (context: DockViewDropContext) => void
}

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
  enableTabDocking = false,
  revealAutoHiddenTab = false,
  canDockView = undefined,
  addViewOptions = undefined,
  dockRootController = undefined,
} = defineProps<{
  parentDirection?: 'row' | 'column' | undefined

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
  /** Enable mouse-driven tab reordering and pane docking. */
  enableTabDocking?: boolean
  /** Show a border menu for managing an auto-hidden single tab. */
  revealAutoHiddenTab?: boolean
  /** Host policy for accepting a proposed tab drop. */
  canDockView?: ((context: DockViewDropContext) => boolean) | undefined
  /** Optional built-in add-tab menu entries. */
  addViewOptions?:
    | readonly DockViewAddOption[]
    | ((context: AddViewContext) => readonly DockViewAddOption[])
    | undefined
  /** Internal controller passed only to recursive DockView instances. */
  dockRootController?: DockRootController | undefined
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
  (e: 'view-activated', ctx: ViewActivatedContext): void
  (e: 'view-docked', ctx: DockViewDropContext): void
}>()

const localDockRootId = useId().replaceAll(':', '-')
const dockRoot: DockRootController = dockRootController ?? {
  id: localDockRootId,
  node: nodeModel,
  drag: ref(null),
  preview: ref(null),
  viewHosts: shallowRef(new Map()),
  availableViewTypes: Object.keys(slots),
  emitDocked: (context) => emit('view-docked', context),
}
const isDockRoot = dockRootController === undefined

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

const toDomToken = (value: string): string =>
  Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('')

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

const getViewHostId = (leafId: string, viewId: string): string =>
  `dock-host-${dockRoot.id}-${toDomToken(leafId)}-${toDomToken(viewId)}`

const registerViewHost = (viewId: string, element: unknown) => {
  if (!(element instanceof HTMLElement) || dockRoot.viewHosts.value.get(viewId) === element) return
  dockRoot.viewHosts.value = new Map(dockRoot.viewHosts.value).set(viewId, element)
}

const mountedViewTargets = computed(() => {
  const targets: Array<{ viewId: string; element: HTMLElement }> = []
  const visit = (current: DockNode) => {
    if (current.type === 'container') {
      for (const child of current.children ?? []) visit(child)
      return
    }

    const activeIndex = current.activeViewIndex ?? 0
    const collapsed = current.collapsed === true || current.size === 0
    for (const [index, viewId] of (current.views ?? []).entries()) {
      if (
        (collapsed || index !== activeIndex) &&
        !(current.keepAliveViews ?? []).includes(viewId)
      ) {
        continue
      }
      const element = dockRoot.viewHosts.value.get(viewId)
      if (element) targets.push({ viewId, element })
    }
  }
  visit(dockRoot.node.value)
  return targets
})

const isDocking = computed(() => enableTabDocking && dockRoot.drag.value !== null)
const contentDropPosition = computed(() => {
  const preview = dockRoot.preview.value
  if (preview?.targetLeafId !== node.value.id || preview.targetIndex !== undefined) return undefined
  return preview.position === 'tab' ? 'center' : preview.position
})

const hasUniqueViewIds = (): boolean => {
  const ids = viewIds(dockRoot.node.value)
  return new Set(ids).size === ids.length
}

const canDragLeafView = (leafId: string, viewId: string): boolean => {
  const leaf = findLeaf(dockRoot.node.value, leafId)
  return (
    enableTabDocking &&
    leaf !== undefined &&
    leaf.collapsed !== true &&
    leaf.size !== 0 &&
    hasUniqueViewIds() &&
    (leaf.views ?? []).includes(viewId)
  )
}

const canDragView = (viewId: string): boolean =>
  node.value.type === 'leaf' && canDragLeafView(node.value.id, viewId)

const stopTabDrag = () => {
  dockRoot.drag.value = null
  dockRoot.preview.value = null
}

const startTabDrag = (event: DragEvent, leafId: string, viewId: string, sourceIndex: number) => {
  if (!canDragLeafView(leafId, viewId)) {
    event.preventDefault()
    return
  }
  dockRoot.drag.value = { viewId, sourceLeafId: leafId, sourceIndex }
  event.dataTransfer?.setData('text/x-taskyon-dock-view', dockRoot.id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    const dragImage = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
      '.dock-tab-drag-image',
    )
    if (dragImage) event.dataTransfer.setDragImage(dragImage, 12, 12)
  }
}

const onTabDragStart = (event: DragEvent, viewId: string, sourceIndex: number) => {
  if (node.value.type !== 'leaf') {
    event.preventDefault()
    return
  }
  startTabDrag(event, node.value.id, viewId, sourceIndex)
}

const dropContext = (preview: DockDropPreview): DockViewDropContext | undefined => {
  const drag = dockRoot.drag.value
  if (!drag) return undefined
  return { ...drag, ...preview }
}

const acceptsDrop = (preview: DockDropPreview): boolean => {
  const context = dropContext(preview)
  if (!context) return false
  const sourceLeaf = findLeaf(dockRoot.node.value, context.sourceLeafId)
  if (
    context.position !== 'tab' &&
    context.sourceLeafId === context.targetLeafId &&
    (sourceLeaf?.views?.length ?? 0) <= 1
  ) {
    return false
  }
  return canDockView?.(context) ?? true
}

const setDropPreview = (event: DragEvent, preview: DockDropPreview) => {
  if (!acceptsDrop(preview)) {
    dockRoot.preview.value = null
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dockRoot.preview.value = preview
}

const edgeDropPosition = (event: DragEvent): Exclude<DockPosition, 'tab'> | 'tab' => {
  const element = event.currentTarget
  if (!(element instanceof HTMLElement)) return 'tab'
  const rect = element.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const edgeX = rect.width * 0.25
  const edgeY = rect.height * 0.25
  const candidates = [
    { position: 'left' as const, distance: x / edgeX },
    { position: 'right' as const, distance: (rect.width - x) / edgeX },
    { position: 'top' as const, distance: y / edgeY },
    { position: 'bottom' as const, distance: (rect.height - y) / edgeY },
  ].filter(({ distance }) => distance <= 1)
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.position ?? 'tab'
}

const onContentDragOver = (event: DragEvent) => {
  if (!dockRoot.drag.value || node.value.type !== 'leaf') return
  const position = isCollapsed.value ? 'tab' : edgeDropPosition(event)
  setDropPreview(event, { targetLeafId: node.value.id, position })
}

const tabInsertIndex = (event: DragEvent, index: number): number => {
  const element = event.currentTarget
  if (!(element instanceof HTMLElement)) return index
  const rect = element.getBoundingClientRect()
  const vertical = resolvedTabPosition.value === 'left'
  const pointer = vertical ? event.clientY - rect.top : event.clientX - rect.left
  const length = vertical ? rect.height : rect.width
  return pointer < length / 2 ? index : index + 1
}

const onTabDragOver = (event: DragEvent, index: number) => {
  if (!dockRoot.drag.value || node.value.type !== 'leaf') return
  setDropPreview(event, {
    targetLeafId: node.value.id,
    targetIndex: tabInsertIndex(event, index),
    position: 'tab',
  })
}

const onTabHeaderDragOver = (event: DragEvent) => {
  if (!dockRoot.drag.value || node.value.type !== 'leaf') return
  setDropPreview(event, {
    targetLeafId: node.value.id,
    targetIndex: node.value.views?.length ?? 0,
    position: 'tab',
  })
}

const commitDrop = (event: DragEvent, fallback?: DockDropPreview) => {
  event.preventDefault()
  event.stopPropagation()
  const preview = dockRoot.preview.value ?? fallback
  if (!preview || !acceptsDrop(preview)) {
    stopTabDrag()
    return
  }
  const context = dropContext(preview)
  if (!context) return
  dockRoot.node.value = applyDockDrop(dockRoot.node.value, context)
  dockRoot.emitDocked(context)
  stopTabDrag()
}

const onContentDrop = (event: DragEvent) => commitDrop(event)

const onTabDrop = (event: DragEvent, index: number) =>
  commitDrop(event, {
    targetLeafId: node.value.id,
    targetIndex: tabInsertIndex(event, index),
    position: 'tab',
  })

const onTabHeaderDrop = (event: DragEvent) =>
  commitDrop(event, {
    targetLeafId: node.value.id,
    targetIndex: node.value.views?.length ?? 0,
    position: 'tab',
  })

const isTabHeaderDropTarget = computed(() => {
  const preview = dockRoot.preview.value
  return (
    preview?.targetLeafId === node.value.id &&
    preview.position === 'tab' &&
    preview.targetIndex === (node.value.views?.length ?? 0)
  )
})

const getTabDropClass = (index: number): string => {
  const preview = dockRoot.preview.value
  if (preview?.targetLeafId !== node.value.id || preview.position !== 'tab') return ''
  if (preview.targetIndex === index) return 'dock-tab--drop-before'
  if (
    preview.targetIndex === (node.value.views?.length ?? 0) &&
    index === preview.targetIndex - 1
  ) {
    return 'dock-tab--drop-after'
  }
  return ''
}

const addViewContext = (
  selectedOptionId?: string,
  position: DockPosition = 'tab',
): AddViewContext => ({
  leafId: node.value.id,
  position,
  currentViews: node.value.views ?? [],
  availableViewTypes: dockRoot.availableViewTypes,
  ...(selectedOptionId ? { selectedOptionId } : {}),
})

const resolvedAddViewOptions = computed(() => {
  if (node.value.type !== 'leaf' || !addViewOptions) return []
  const options =
    typeof addViewOptions === 'function' ? addViewOptions(addViewContext()) : addViewOptions
  const present = new Set(viewIds(dockRoot.node.value))
  return options.filter((option) => !option.viewId || !present.has(option.viewId))
})

const showAddViewMenu = ref(false)
const addViewQuery = ref('')
const filteredAddViewOptions = computed(() => {
  const query = addViewQuery.value.trim().toLocaleLowerCase()
  if (!query) return resolvedAddViewOptions.value
  return resolvedAddViewOptions.value.filter(({ id, label }) =>
    [id, label].some((value) => value.toLocaleLowerCase().includes(query)),
  )
})
const splitterSides = ['left', 'right'] as const
const splitPlacements = [
  { position: 'left', label: 'Split left', icon: 'west' },
  { position: 'right', label: 'Split right', icon: 'east' },
  { position: 'top', label: 'Split above', icon: 'north' },
  { position: 'bottom', label: 'Split below', icon: 'south' },
] as const

const setAutoHideSingleTab = (enabled: boolean) => {
  if (node.value.type !== 'leaf') return
  node.value = { ...node.value, showTabs: enabled ? 'auto' : 'always' }
}

const setSmartTabs = (enabled: boolean) => {
  if (node.value.type !== 'leaf') return
  node.value = { ...node.value, tabLayout: enabled ? 'smart' : 'scroll' }
}

const setVerticalTabs = (enabled: boolean) => {
  if (node.value.type !== 'leaf') return
  node.value = { ...node.value, tabPosition: enabled ? 'left' : 'top' }
}

const addViewToRootLeaf = (
  leafId: string,
  result: AddViewResult,
  position: DockPosition = 'tab',
) => {
  if (viewIds(dockRoot.node.value).includes(result.viewId)) return
  if (position !== 'tab') {
    dockRoot.node.value = splitDockView(dockRoot.node.value, {
      targetLeafId: leafId,
      viewId: result.viewId,
      position,
    })
    return
  }
  dockRoot.node.value = updateLeaf(dockRoot.node.value, leafId, (leaf) =>
    addViewToLeaf(leaf, result.viewId, result.makeActive ?? true),
  )
}

const onAddViewOptionClick = (option: DockViewAddOption, position: DockPosition = 'tab') => {
  if (node.value.type !== 'leaf') return
  if (option.viewId) {
    addViewToRootLeaf(node.value.id, { viewId: option.viewId, makeActive: true }, position)
    return
  }
  emit('add-view', addViewContext(option.id, position), (result) => {
    if (result?.viewId) addViewToRootLeaf(node.value.id, result, position)
  })
}

const isCollapsed = computed(() => {
  const n = node.value
  if (n.type !== 'leaf') return false
  return n.collapsed === true || n.size === 0
})

const resolvedTabPosition = computed(() => node.value.tabPosition ?? tabPosition)

const isLeftTabsLayout = computed(
  () => node.value.type === 'leaf' && resolvedTabPosition.value === 'left' && !isCollapsed.value,
)

const smartTabsEnabled = computed(
  () =>
    node.value.type === 'leaf' &&
    node.value.tabLayout === 'smart' &&
    !isCollapsed.value &&
    !isLeftTabsLayout.value,
)

const isCompactTabRail = computed(
  () => isLeftTabsLayout.value && !isCollapsed.value && node.value.tabRailMode === 'compact',
)

const isTabRailCollapsible = computed(
  () => isLeftTabsLayout.value && !isCollapsed.value && node.value.tabRailCollapsible === true,
)

const toggleTabRail = () => {
  const n = node.value
  if (n.type !== 'leaf' || !isTabRailCollapsible.value) return
  node.value = {
    ...n,
    tabRailMode: isCompactTabRail.value ? 'expanded' : 'compact',
  }
}

const activateLeafView = (n: DockNode, index: number): DockNode => {
  const activated = setActiveView(n, index)
  if (n.tabRailAutoCompact !== true || resolvedTabPosition.value !== 'left') return activated
  return { ...activated, tabRailMode: 'compact' }
}

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
  const viewId = n.views?.[index]
  if (!viewId) return

  // first expand
  if (isCollapsed.value) {
    const restored = getLeafRestoreSize(n)
    node.value = {
      ...activateLeafView({ ...n, collapsed: false, size: restored }, index),
    }
  } else {
    node.value = activateLeafView(n, index)
  }
  emit('view-activated', { leafId: n.id, viewId, index })
}

/* ---------- Layout-related computed ---------- */

const tabDisplayMode = computed(() =>
  node.value.type === 'leaf' ? (node.value.showTabs ?? 'always') : 'never',
)
const showTabItems = computed(() => {
  if (node.value.type === 'container') return false
  const mode = tabDisplayMode.value
  if (mode === 'never') return false
  if (mode === 'always') return true
  if (revealAutoHiddenTab && isDockRoot) return true
  return (node.value.views?.length ?? 0) > 1
})
const showPaneControls = computed(() => tabDisplayMode.value !== 'never')
const controlsOnly = computed(
  () => showPaneControls.value && !showTabItems.value && !isCollapsed.value,
)
const managedAutoHiddenViewId = computed(() => {
  if (!revealAutoHiddenTab || !controlsOnly.value || node.value.type !== 'leaf') return undefined
  const views = node.value.views ?? []
  return views.length === 1 ? views[0] : undefined
})
const showTabHeader = computed(
  () => showTabItems.value || (controlsOnly.value && !hideTabAdd && !managedAutoHiddenViewId.value),
)

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

const getSplitterHiddenTab = (splitterIndex: number, side: 'left' | 'right') => {
  const current = node.value
  if (!revealAutoHiddenTab || current.type !== 'container' || !current.children) return undefined
  const childIndex = side === 'left' ? splitterIndex : splitterIndex + 1

  // A middle pane belongs to the splitter after it; the final pane belongs to the one before it.
  if (side === 'right' && childIndex !== current.children.length - 1) return undefined

  const child = current.children[childIndex]
  if (
    child?.type !== 'leaf' ||
    child.showTabs !== 'auto' ||
    child.collapsed === true ||
    child.size === 0 ||
    child.views?.length !== 1
  ) {
    return undefined
  }
  return { leafId: child.id, viewId: child.views[0]! }
}

const getSplitterHiddenTabTitle = (splitterIndex: number, side: 'left' | 'right'): string => {
  const hiddenTab = getSplitterHiddenTab(splitterIndex, side)
  return hiddenTab ? (tabTitles[hiddenTab.viewId] ?? hiddenTab.viewId) : ''
}

const showSplitterHiddenTab = (splitterIndex: number, side: 'left' | 'right') => {
  const hiddenTab = getSplitterHiddenTab(splitterIndex, side)
  if (!hiddenTab) return
  dockRoot.node.value = updateLeaf(dockRoot.node.value, hiddenTab.leafId, (leaf) => ({
    ...leaf,
    showTabs: 'always',
  }))
}

const canCloseSplitterHiddenTab = (splitterIndex: number, side: 'left' | 'right'): boolean => {
  const hiddenTab = getSplitterHiddenTab(splitterIndex, side)
  return Boolean(hiddenTab && !hideTabClose && !pinnedViews.includes(hiddenTab.viewId))
}

const closeSplitterHiddenTab = (splitterIndex: number, side: 'left' | 'right') => {
  const hiddenTab = getSplitterHiddenTab(splitterIndex, side)
  if (!hiddenTab || !canCloseSplitterHiddenTab(splitterIndex, side)) return
  dockRoot.node.value = closeDockView(dockRoot.node.value, hiddenTab.leafId, hiddenTab.viewId)
}

const onSplitterTabDragStart = (
  event: DragEvent,
  splitterIndex: number,
  side: 'left' | 'right',
) => {
  const hiddenTab = getSplitterHiddenTab(splitterIndex, side)
  if (!hiddenTab) {
    event.preventDefault()
    return
  }
  startTabDrag(event, hiddenTab.leafId, hiddenTab.viewId, 0)
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
  const n = node.value
  if (n.type !== 'leaf') return
  const viewId = n.views?.[index]
  if (!viewId) return
  node.value = activateLeafView(n, index)
  emit('view-activated', { leafId: n.id, viewId, index })
}

const onTabClose = (viewId: string) => {
  dockRoot.node.value = closeDockView(dockRoot.node.value, node.value.id, viewId)
}

/* ---------- Add tab ("+") handlers ---------- */

const onAddTabClick = () => {
  if (node.value.type !== 'leaf') return

  if (addViewOptions !== undefined) {
    addViewQuery.value = ''
    showAddViewMenu.value = true
    return
  }

  const ctx = addViewContext()

  const done: AddViewDone = (result) => {
    if (result?.viewId) addViewToRootLeaf(node.value.id, result)
  }

  emit('add-view', ctx, done)
}

/** Forward add-view events from children up the tree. */
const onChildAddView = (ctx: AddViewContext, done: AddViewDone) => {
  emit('add-view', ctx, done)
}

const onChildViewActivated = (ctx: ViewActivatedContext) => {
  emit('view-activated', ctx)
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
  &.dock-resizing :deep(iframe),
  &.dock-dragging :deep(iframe) {
    pointer-events: none !important;
  }

  &.dock-row {
    flex-direction: row;
  }

  &.dock-node--tabs-left {
    flex-direction: row;
  }
}

.dock-node--animated {
  transition:
    flex-basis 180ms ease,
    flex-grow 180ms ease,
    flex-shrink 180ms ease;
}

.dock-node--animated > .dock-tabs-header {
  transition:
    width 180ms ease,
    min-width 180ms ease;
}

.dock-resizing .dock-node--animated {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .dock-node--animated,
  .dock-node--animated > .dock-tabs-header {
    transition: none;
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
    width: var(--dock-splitter-size, 8px);
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
    height: var(--dock-splitter-size, 8px);
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
  top: 50%;
  left: 50%;
  z-index: 2;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.dock-splitter.row .dock-splitter-controls {
  flex-direction: column;
}

.dock-splitter.column .dock-splitter-controls {
  flex-direction: row;
}

.dock-splitter:hover .dock-splitter-controls,
.dock-splitter:focus-within .dock-splitter-controls,
.dock-splitter-controls:hover {
  opacity: 1;
}

.dock-splitter-tab-menu {
  display: flex;
}

.dock-splitter-toggle,
.dock-splitter-tab-menu-trigger {
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

.dock-splitter-toggle:hover,
.dock-splitter-tab-menu-trigger:hover,
.dock-splitter-tab-menu-trigger:focus-visible {
  opacity: 1;
  filter: brightness(1.12);
  background: rgba(30, 30, 30, 0.75);
  border-color: rgba(255, 255, 255, 0.85);
  color: white;
}

.dock-splitter-tab-menu-trigger {
  cursor: grab;
}

.dock-splitter-tab-menu-trigger:active {
  cursor: grabbing;
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
    width: var(--dock-tab-rail-width, 132px);
    min-width: var(--dock-tab-rail-width, 132px);
    padding-block: 0.25rem;
  }

  &.dock-tabs-header--compact {
    width: var(--dock-tab-rail-compact-width, 44px);
    min-width: var(--dock-tab-rail-compact-width, 44px);
    overflow: visible;
  }
}

.dock-tabs-header--controls-only {
  position: absolute;
  top: 2px;
  right: 28px;
  z-index: 5;
  width: auto;
  min-width: 24px;
  padding: 0;
  overflow: visible;
  border: 0;
}

.dock-tabs-header--smart:not(.dock-tabs-header--controls-only) {
  --dock-smart-tab-row-height: 32px;

  flex-wrap: wrap;
  align-content: flex-start;
  max-height: calc(var(--dock-smart-tab-row-height) * 3);
  overflow-x: hidden;
  overflow-y: auto;
}

.dock-tabs-header--smart:not(.dock-tabs-header--controls-only) .dock-tab {
  box-sizing: border-box;
  flex: 1 1 0;
  min-width: var(--dock-smart-tab-min-width, 88px);
  max-width: var(--dock-smart-tab-max-width, 180px);
  height: var(--dock-smart-tab-row-height);
}

.dock-hidden-tab-menu {
  min-width: 220px;
}

/* Individual tab */
.dock-tab {
  position: relative;
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

.dock-tab-drag-image {
  position: fixed;
  top: -10000px;
  left: -10000px;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 240px;
  padding: 0.4rem 0.65rem;
  overflow: hidden;
  color: var(--dock-drag-image-color, currentColor);
  white-space: nowrap;
  text-overflow: ellipsis;
  background: var(--dock-drag-image-background, Canvas);
  border: 1px solid var(--dock-drag-image-border, currentColor);
  border-radius: var(--dock-drag-image-radius, 4px);
  box-shadow: var(--dock-drag-image-shadow, 0 4px 12px rgb(0 0 0 / 18%));
}

.dock-tab--drop-before::before,
.dock-tab--drop-after::after {
  content: '';
  position: absolute;
  z-index: 8;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 2px;
  background: var(--dock-drop-indicator, currentColor);
}

.dock-tab--drop-before::before {
  left: -1px;
}

.dock-tab--drop-after::after {
  right: -1px;
}

.dock-tabs-header--left .dock-tab--drop-before::before,
.dock-tabs-header--left .dock-tab--drop-after::after {
  right: 3px;
  left: 3px;
  width: auto;
  height: 3px;
}

.dock-tabs-header--left .dock-tab--drop-before::before {
  top: -1px;
  bottom: auto;
}

.dock-tabs-header--left .dock-tab--drop-after::after {
  top: auto;
  bottom: -1px;
}

.dock-tabs-header--drop-empty::after {
  content: '';
  align-self: stretch;
  width: 3px;
  min-height: 24px;
  margin: 3px;
  border-radius: 2px;
  background: var(--dock-drop-indicator, currentColor);
}

.dock-tabs-header--left.dock-tabs-header--drop-empty::after {
  width: auto;
  height: 3px;
  min-height: 3px;
}

/* Tabs within the vertical strip:
   - make tab contents (icon, title, close) vertical as well */
.dock-tabs-header--vertical .dock-tab {
  padding: 0.35rem 0.2rem;
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
    max-inline-size: 8rem; /* limits “length” of unusually long vertical labels */
    overflow: hidden;
    font-size: 0.8rem;

    /* optional spacing similar to horizontal tab */
    margin-top: 0.125rem;
  }

  .dock-tab-close {
    margin-left: 0;
    margin-top: 0.25rem;
  }
}

.dock-tabs-header--left .dock-tab {
  position: relative;
  border-bottom: none;
  border-right: 2px solid transparent;
  padding: 0.35rem 0.6rem;
}

.dock-tabs-header--compact .dock-tab {
  justify-content: center;
  min-height: 40px;
  padding-inline: 0.35rem;
}

.dock-tabs-header--compact .dock-tab-icon {
  margin-right: 0;
}

.dock-tabs-header--compact .dock-tab-title {
  position: absolute;
  top: 50%;
  left: calc(100% + 6px);
  z-index: 5;
  width: max-content;
  max-width: min(18rem, 60vw);
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--dock-tab-flyout-border, currentColor);
  border-radius: var(--dock-tab-flyout-radius, 4px);
  color: var(--dock-tab-flyout-color, CanvasText);
  background: var(--dock-tab-flyout-background, Canvas);
  box-shadow: var(--dock-tab-flyout-shadow, 0 2px 6px rgb(0 0 0 / 18%));
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 0.12s ease;
}

.dock-tabs-header--compact .dock-tab:hover .dock-tab-title,
.dock-tabs-header--compact .dock-tab:focus-visible .dock-tab-title {
  opacity: 1;
}

.dock-tabs-header--left .dock-tab.active {
  border-right-color: currentColor;
}

.dock-tabs-header--left .dock-tab-close {
  margin-left: auto;
}

.dock-tabs-header--left .dock-tab-add,
.dock-tabs-header--left .dock-tab-rail-toggle {
  margin-left: 0;
  margin-top: 0.25rem;
  align-self: center;
}

.dock-tabs-header--left .dock-tab-rail-toggle {
  position: sticky;
  top: 0;
  z-index: 4;
  margin-top: 0;
  margin-bottom: 0.25rem;
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

.dock-add-menu {
  min-width: 260px;
}

.dock-tabs-header--vertical .dock-tab-add,
.dock-tabs-header--vertical .dock-tab-rail-toggle {
  margin-left: 0;
  margin-top: 0.25rem;
  align-self: center;
}

/* Pane minimize / restore control */
.dock-pane-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 6;
  border: none;
  background: var(--dock-pane-toggle-background, Canvas);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  min-width: 24px;
  min-height: 24px;
  font-size: 0.75rem;
  color: inherit;
}

.dock-node:not(.dock-node--tabs-left) > .dock-tabs-header {
  padding-right: 28px;
}

.dock-node:not(.dock-node--tabs-left) > .dock-tabs-header--vertical {
  padding-top: 30px;
  padding-right: 0;
}

.dock-tab-rail-toggle {
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Content */
/* Base: shared bits */
.dock-content {
  position: relative;
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

.dock-drop-preview {
  position: absolute;
  z-index: 10;
  pointer-events: none;
  border: 2px solid var(--dock-drop-preview-border, currentColor);
  border-radius: var(--dock-drop-preview-radius, 4px);
  background: var(--dock-drop-preview-background, color-mix(in srgb, currentColor 14%, Canvas));
}

.dock-drop-preview--center {
  inset: 6px;
}

.dock-drop-preview--left {
  inset: 0 50% 0 0;
}

.dock-drop-preview--right {
  inset: 0 0 0 50%;
}

.dock-drop-preview--top {
  inset: 0 0 50% 0;
}

.dock-drop-preview--bottom {
  inset: 50% 0 0;
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
