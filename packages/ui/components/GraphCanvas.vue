<template>
  <div class="graph-canvas-wrap column no-wrap">
    <GraphCanvasControls
      v-if="controls"
      :layout="layout"
      :show-layout="showLayoutControls"
      :node-options="nodeOptions"
      :visible-node-ids="visibleNodeIds"
      :pan-zoom-enabled="panZoomEnabled"
      :node-drag-enabled="nodeDragEnabled"
      :copying="copying"
      v-bind="effectiveSelectedNodeId ? { selectedNodeId: effectiveSelectedNodeId } : {}"
      @update:layout="updatePresentation({ layout: $event })"
      @update:visible-node-ids="visibleNodeIds = $event"
      @update:pan-zoom-enabled="updatePresentation({ panZoomEnabled: $event })"
      @update:node-drag-enabled="updatePresentation({ nodeDragEnabled: $event })"
      @fit="fit"
      @focus-selected="focusSelected"
      @copy-png="onCopyPng"
      @export-svg="downloadSvg"
    >
      <slot name="controls" />
    </GraphCanvasControls>
    <div ref="containerRef" class="graph-canvas col"></div>
  </div>
</template>

<script setup lang="ts" generic="N = unknown, E = unknown">
import {
  createGraphController,
  filterVisibleGraph,
  findUpstreamGraphSelection,
  graphViewLayoutOptions,
  type GraphData,
  type GraphPresentationState,
  type GraphPngExportOptions,
  type GraphViewLayout,
  type LayoutEdge,
  type LayoutNode,
  type RenderOptions,
  type ViewportState,
} from '@taskyon/common/modules/graph'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GraphCanvasControls from './GraphCanvasControls.vue'

defineSlots<{ controls: () => unknown }>()

const props = withDefaults(
  defineProps<{
    graph: GraphData<N, E>
    options?: RenderOptions<N, E>
    selectedNodeId?: string
    controls?: boolean
    showLayoutControls?: boolean
    pngExportOptions?: GraphPngExportOptions
    svgFileName?: string
    presentation?: GraphPresentationState
  }>(),
  {
    controls: true,
    showLayoutControls: true,
    svgFileName: 'graph.svg',
  },
)
const emit = defineEmits<{
  selectNode: [nodeId: string]
  nodeContextMenu: [payload: { nodeId: string; clientX: number; clientY: number }]
  'update:presentation': [presentation: GraphPresentationState]
}>()

const layoutFromOptions = (options: RenderOptions<N, E> | undefined): GraphViewLayout => {
  if (options?.layoutMode === 'organic') return 'organic'
  return options?.direction === 'TB' ? 'vertical' : 'flow'
}

const containerRef = ref<HTMLElement | null>(null)
const layout = ref<GraphViewLayout>(props.presentation?.layout ?? layoutFromOptions(props.options))
const visibleNodeIds = ref(props.graph.nodes.map(({ id }) => id))
const panZoomEnabled = ref(
  props.presentation?.panZoomEnabled ?? props.options?.enablePanZoom !== false,
)
const nodeDragEnabled = ref(
  props.presentation?.nodeDragEnabled ?? props.options?.enableNodeDrag !== false,
)
const viewport = ref<ViewportState | undefined>(
  props.presentation?.viewport ?? props.options?.initialViewport,
)
const internalSelectedNodeId = ref<string>()
const copying = ref(false)
let controller: ReturnType<typeof createGraphController<N, E>> | null = null
let resizeObserver: ResizeObserver | null = null

const effectiveSelectedNodeId = computed(() => props.selectedNodeId ?? internalSelectedNodeId.value)
const nodeOptions = computed(() =>
  props.graph.nodes.map(({ id, label }) => ({ id, label: label ?? id })),
)
const visibleGraph = computed(() => filterVisibleGraph(props.graph, new Set(visibleNodeIds.value)))
const upstreamSelection = computed(() => {
  const selectedNodeId = effectiveSelectedNodeId.value
  if (!selectedNodeId || !props.options?.upstreamSelectionStyles) return undefined
  return findUpstreamGraphSelection(visibleGraph.value, selectedNodeId)
})
const updatePresentation = (patch: Partial<GraphPresentationState>) => {
  if (patch.layout !== undefined) layout.value = patch.layout
  if (patch.panZoomEnabled !== undefined) panZoomEnabled.value = patch.panZoomEnabled
  if (patch.nodeDragEnabled !== undefined) nodeDragEnabled.value = patch.nodeDragEnabled
  if (patch.viewport !== undefined) viewport.value = patch.viewport
  emit('update:presentation', {
    layout: layout.value,
    panZoomEnabled: panZoomEnabled.value,
    nodeDragEnabled: nodeDragEnabled.value,
    ...(viewport.value ? { viewport: viewport.value } : {}),
  })
}
const makeRuntimeOptions = (): RenderOptions<N, E> => {
  const base = props.options ?? {}
  const selectionStyles = base.upstreamSelectionStyles
  return {
    ...base,
    ...(props.showLayoutControls ? graphViewLayoutOptions(layout.value) : {}),
    enablePanZoom: panZoomEnabled.value,
    enableNodeDrag: nodeDragEnabled.value,
    ...(viewport.value ? { initialViewport: viewport.value } : {}),
    onViewportChange: (nextViewport) => {
      updatePresentation({ viewport: nextViewport })
      base.onViewportChange?.(nextViewport)
    },
    nodeTooltipHtml:
      base.nodeTooltipHtml ??
      ((node: LayoutNode<N>) =>
        `<div><strong>${node.label ?? node.id}</strong><div>${node.id}</div></div>`),
    edgeTooltipHtml:
      base.edgeTooltipHtml ??
      ((edge: LayoutEdge<E>) =>
        edge.label ? `<div><strong>${edge.label}</strong></div>` : `<div>${edge.id}</div>`),
    nodeStyle: (node) => {
      const baseStyle = base.nodeStyle?.(node)
      const selection = upstreamSelection.value
      if (!selection || !selectionStyles) return baseStyle
      const selectionStyle =
        node.id === effectiveSelectedNodeId.value
          ? selectionStyles.selectedNode
          : selection.nodeIds.has(node.id)
            ? selectionStyles.upstreamNode
            : selectionStyles.unrelatedNode
      return baseStyle || selectionStyle ? { ...baseStyle, ...selectionStyle } : undefined
    },
    edgeStyle: (edge) => {
      const baseStyle = base.edgeStyle?.(edge)
      const selection = upstreamSelection.value
      if (!selection || !selectionStyles) return baseStyle
      const selectionStyle = selection.edgeIds.has(edge.id)
        ? selectionStyles.upstreamEdge
        : selectionStyles.unrelatedEdge
      return baseStyle || selectionStyle ? { ...baseStyle, ...selectionStyle } : undefined
    },
    onNodeClick: (node) => {
      internalSelectedNodeId.value = node.id
      emit('selectNode', node.id)
      base.onNodeClick?.(node)
    },
    onNodeContextMenu: (node, location) => {
      emit('nodeContextMenu', { nodeId: node.id, ...location })
      base.onNodeContextMenu?.(node, location)
    },
  }
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return
  controller = createGraphController(container, visibleGraph.value, makeRuntimeOptions())
  resizeObserver = new ResizeObserver(() => controller?.resize())
  resizeObserver.observe(container)
})

const fit = () => controller?.fit()
const focusNode = (nodeId: string) => controller?.focusNode(nodeId) ?? false
const focusSelected = () => {
  if (effectiveSelectedNodeId.value) focusNode(effectiveSelectedNodeId.value)
}
const showNode = async (nodeId: string) => {
  if (!visibleNodeIds.value.includes(nodeId))
    visibleNodeIds.value = [...visibleNodeIds.value, nodeId]
  await nextTick()
  return focusNode(nodeId)
}
const copyAsPng = (options?: GraphPngExportOptions) =>
  controller?.copyAsPng(options) ?? Promise.resolve(false)
const onCopyPng = async () => {
  if (copying.value) return
  copying.value = true
  try {
    await copyAsPng(props.pngExportOptions)
  } finally {
    copying.value = false
  }
}
const downloadSvg = (fileName = props.svgFileName) => controller?.downloadSvg(fileName)

defineExpose({ fit, focusNode, showNode, copyAsPng, downloadSvg })

watch(
  () => props.graph.nodes.map(({ id }) => id),
  (nextIds, previousIds) => {
    const previous = new Set(previousIds)
    const retained = visibleNodeIds.value.filter((id) => nextIds.includes(id))
    const added = nextIds.filter((id) => !previous.has(id))
    visibleNodeIds.value = [...retained, ...added]
  },
)
watch(
  () => props.presentation,
  (presentation) => {
    if (!presentation) return
    layout.value = presentation.layout
    panZoomEnabled.value = presentation.panZoomEnabled
    nodeDragEnabled.value = presentation.nodeDragEnabled
    viewport.value = presentation.viewport
    if (presentation.viewport) controller?.setViewport(presentation.viewport)
  },
  { deep: true },
)
watch(visibleGraph, (next) => controller?.setGraph(next))
watch(effectiveSelectedNodeId, () => controller?.redraw())
watch(
  () => [props.options, layout.value, panZoomEnabled.value, nodeDragEnabled.value] as const,
  () => controller?.setOptions(makeRuntimeOptions()),
  { deep: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  controller?.destroy()
  controller = null
})
</script>

<style scoped>
.graph-canvas-wrap {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.graph-canvas {
  width: 100%;
  min-height: 480px;
}
</style>
