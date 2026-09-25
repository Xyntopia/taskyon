import { computeLayoutBounds, layoutGraph, routeLayoutEdges, routeOrganicEdges } from './layout'
import { findUndirectedGraphNeighborhood } from './graphView'
import {
  applyOrganicLayout,
  createOrganicLayoutState,
  moveOrganicNode,
  organicLayoutIterationsPerFrame,
  releaseOrganicNode,
  stepOrganicLayout,
  type OrganicLayoutState,
} from './organicLayout'
import { svgStringToPngUint8 } from '../svgUtils'
import {
  applyWheelZoom,
  fitGraphToViewport,
  initialViewportState,
  viewportTransform,
} from './interactions'
import type {
  EdgeStyle,
  GraphData,
  GraphTheme,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  NodeStyle,
  RenderOptions,
  ViewportState,
} from './types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const ORGANIC_DRAG_NEIGHBORHOOD_HOPS = 2
const ORGANIC_DRAG_ITERATIONS_PER_FRAME = 2

const createSvgEl = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
  document.createElementNS(SVG_NS, tag)

const mergeNodeStyle = (theme: GraphTheme | undefined, node: LayoutNode): Required<NodeStyle> => {
  const base = theme?.defaultNodeStyle ?? {}
  const custom = node.type ? (theme?.nodeStyles?.[node.type] ?? {}) : {}
  return {
    fill: custom.fill ?? base.fill ?? 'rgba(16, 24, 40, 0.06)',
    stroke: custom.stroke ?? base.stroke ?? 'rgba(16, 24, 40, 0.45)',
    strokeWidth: custom.strokeWidth ?? base.strokeWidth ?? 1.5,
    rx: custom.rx ?? base.rx ?? 8,
    ry: custom.ry ?? base.ry ?? 8,
    textColor: custom.textColor ?? base.textColor ?? 'rgba(16, 24, 40, 1)',
    fontSize: custom.fontSize ?? base.fontSize ?? 12,
    fontFamily: custom.fontFamily ?? base.fontFamily ?? 'ui-monospace, SFMono-Regular, monospace',
    fontWeight: custom.fontWeight ?? base.fontWeight ?? 600,
    glowColor: custom.glowColor ?? base.glowColor ?? '',
    glowBlur: custom.glowBlur ?? base.glowBlur ?? 0,
  }
}

const mergePartialNodeStyle = (
  base: Required<NodeStyle>,
  patch: NodeStyle | undefined,
): Required<NodeStyle> => ({
  ...base,
  ...(patch ?? {}),
})

const mergeEdgeStyle = (theme: GraphTheme | undefined, edge: LayoutEdge): Required<EdgeStyle> => {
  const base = theme?.defaultEdgeStyle ?? {}
  const custom = edge.type ? (theme?.edgeStyles?.[edge.type] ?? {}) : {}
  return {
    stroke: custom.stroke ?? base.stroke ?? 'rgba(71, 84, 103, 0.9)',
    strokeWidth: custom.strokeWidth ?? base.strokeWidth ?? 1.4,
    dasharray: custom.dasharray ?? base.dasharray ?? '',
    opacity: custom.opacity ?? base.opacity ?? 1,
    glowColor: custom.glowColor ?? base.glowColor ?? '',
    glowBlur: custom.glowBlur ?? base.glowBlur ?? 0,
  }
}

const setAttrs = (el: Element, attrs: Record<string, string | number | undefined>) => {
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined) return
    el.setAttribute(key, String(value))
  })
}

const clearChildren = (el: Element) => {
  while (el.firstChild) el.removeChild(el.firstChild)
}

const px = (value: string): number => {
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const createTooltip = (container: HTMLElement) => {
  const tooltip = document.createElement('div')
  tooltip.style.position = 'absolute'
  tooltip.style.pointerEvents = 'none'
  tooltip.style.zIndex = '3'
  tooltip.style.display = 'none'
  tooltip.style.maxWidth = '340px'
  tooltip.style.padding = '6px 8px'
  tooltip.style.borderRadius = '6px'
  tooltip.style.background = 'rgba(15, 23, 42, 0.92)'
  tooltip.style.color = 'white'
  tooltip.style.fontSize = '12px'
  tooltip.style.lineHeight = '1.35'
  tooltip.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace'
  container.appendChild(tooltip)
  return tooltip
}

export type GraphPngExportOptions = {
  scale?: number
  cropToContent?: boolean
  cropPadding?: number
  backgroundColor?: string
}

export type GraphSvgExportOptions = {
  includeHtmlLayer?: boolean
  cropToContent?: boolean
  cropPadding?: number
  backgroundColor?: string
}

type GraphController<N = unknown, E = unknown> = {
  setGraph: (graph: GraphData<N, E>) => void
  setOptions: (options: RenderOptions<N, E>) => void
  redraw: () => void
  resize: () => void
  fit: () => void
  focusNode: (nodeId: string) => boolean
  setViewport: (viewport: ViewportState) => void
  copyAsPng: (options?: GraphPngExportOptions) => Promise<boolean>
  exportSvgString: (options?: GraphSvgExportOptions) => string
  downloadSvg: (fileName?: string) => void
  destroy: () => void
}

type GraphSurface = {
  container: HTMLElement
  svg: SVGSVGElement
  scene: SVGGElement
  defs: SVGDefsElement
  edgeLayer: SVGGElement
  nodeLayer: SVGGElement
  htmlLayer: HTMLDivElement
  tooltip: HTMLDivElement
}

type GraphControllerState<N = unknown, E = unknown> = {
  graph: GraphData<N, E>
  options: RenderOptions<N, E>
  layout: LayoutGraph<N, E>
  viewport: ViewportState
  isDragging: boolean
  dragStart: { x: number; y: number; tx: number; ty: number }
  draggedNodeId: string | null
  draggedOrganicNodeIds: ReadonlySet<string> | undefined
  suppressClickForNodeId: string | null
  draggedNodeMoved: boolean
  nodeDragStart: { x: number; y: number; nodeX: number; nodeY: number }
  lastClickForDoubleClick: { nodeId: string; time: number } | null
  lastPointerDownForDoubleClick: { nodeId: string; time: number } | null
  lastDoubleClickDispatch: { nodeId: string; time: number } | null
  organicState: OrganicLayoutState | null
  organicFrame: number | null
  organicIdleFrames: number
}

type GraphEventHandlers = {
  pointerdown: (evt: PointerEvent) => void
  pointermove: (evt: PointerEvent) => void
  pointerup: (evt: PointerEvent) => void
  wheel: (evt: WheelEvent) => void
}

function applyElementStyle(el: HTMLElement | SVGElement, style: Record<string, string>): void {
  Object.assign(el.style, style)
}

function createGraphSurface(container: HTMLElement): GraphSurface {
  applyElementStyle(container, { position: 'relative', overflow: 'hidden' })
  const svg = createSvgEl('svg')
  applyElementStyle(svg, { display: 'block', width: '100%', height: '100%', userSelect: 'none' })
  const scene = createSvgEl('g')
  const defs = createSvgEl('defs')
  const edgeLayer = createSvgEl('g')
  const nodeLayer = createSvgEl('g')
  svg.appendChild(defs)
  scene.append(edgeLayer, nodeLayer)
  svg.appendChild(scene)
  container.appendChild(svg)
  const htmlLayer = document.createElement('div')
  applyElementStyle(htmlLayer, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2',
  })
  container.appendChild(htmlLayer)
  const tooltip = createTooltip(container)
  return { container, svg, scene, defs, edgeLayer, nodeLayer, htmlLayer, tooltip }
}

function showGraphTooltip(
  surface: GraphSurface,
  html: string,
  clientX: number,
  clientY: number,
): void {
  const rect = surface.container.getBoundingClientRect()
  surface.tooltip.innerHTML = html
  surface.tooltip.style.display = 'block'
  surface.tooltip.style.left = `${clientX - rect.left + 10}px`
  surface.tooltip.style.top = `${clientY - rect.top + 10}px`
}

function hideGraphTooltip(surface: GraphSurface): void {
  surface.tooltip.style.display = 'none'
}

function updateSurfaceTransforms(surface: GraphSurface, viewport: ViewportState): void {
  setAttrs(surface.scene, { transform: viewportTransform(viewport) })
  surface.htmlLayer.style.transform = `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`
  surface.htmlLayer.style.transformOrigin = '0 0'
}

function getContainerSize(container: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
  }
}

function emitViewportChange<N, E>(state: GraphControllerState<N, E>): void {
  state.options.onViewportChange?.({ ...state.viewport })
}

function fitGraphToContainer<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  const { width, height } = getContainerSize(surface.container)
  state.viewport = fitGraphToViewport(state.layout, width, height, 24)
  updateSurfaceTransforms(surface, state.viewport)
  emitViewportChange(state)
}

function focusGraphNode<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  nodeId: string,
): boolean {
  const node = state.layout.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return false
  const { width, height } = getContainerSize(surface.container)
  state.viewport = {
    ...state.viewport,
    tx: width / 2 - (node.x + node.width / 2) * state.viewport.scale,
    ty: height / 2 - (node.y + node.height / 2) * state.viewport.scale,
  }
  updateSurfaceTransforms(surface, state.viewport)
  emitViewportChange(state)
  return true
}

function glowFilter(style: { glowColor?: string; glowBlur?: number }): string {
  const blur = style.glowBlur ?? 0
  return style.glowColor && blur > 0 ? `drop-shadow(0 0 ${blur}px ${style.glowColor})` : ''
}

function createArrowMarker(
  defs: SVGDefsElement,
  style: Required<EdgeStyle>,
  markerId: string,
): void {
  const marker = createSvgEl('marker')
  setAttrs(marker, {
    id: markerId,
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
    markerUnits: 'userSpaceOnUse',
  })
  const arrow = createSvgEl('path')
  setAttrs(arrow, {
    d: 'M 0 0 L 10 5 L 0 10 z',
    fill: style.stroke,
    'fill-opacity': style.opacity,
  })
  marker.appendChild(arrow)
  defs.appendChild(marker)
}

function attachEdgeTooltip<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  pathEl: SVGPathElement,
  edge: LayoutEdge<E>,
): void {
  const tip = state.options.edgeTooltipHtml?.(edge)
  if (!tip) {
    pathEl.style.pointerEvents = 'none'
    return
  }
  pathEl.style.pointerEvents = 'stroke'
  pathEl.addEventListener('mousemove', (evt) =>
    showGraphTooltip(surface, tip, evt.clientX, evt.clientY),
  )
  pathEl.addEventListener('mouseleave', () => hideGraphTooltip(surface))
}

function renderGraphEdge<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  edge: LayoutEdge<E>,
  markerByKey: Map<string, string>,
): void {
  const pathEl = createSvgEl('path')
  const style = {
    ...mergeEdgeStyle(state.options.theme, edge),
    ...(state.options.edgeStyle?.(edge) ?? {}),
  }
  const markerKey = `${style.stroke}|${style.opacity}`
  let markerId = markerByKey.get(markerKey)
  if (!markerId) {
    markerId = `graph-arrow-${markerByKey.size}`
    markerByKey.set(markerKey, markerId)
    createArrowMarker(surface.defs, style, markerId)
  }
  setAttrs(pathEl, {
    'data-graph-edge-id': edge.id,
    d: edge.path,
    fill: 'none',
    stroke: style.stroke,
    'stroke-width': style.strokeWidth,
    'stroke-dasharray': style.dasharray,
    'stroke-opacity': style.opacity,
    'marker-end': `url(#${markerId})`,
  })
  pathEl.style.filter = glowFilter(style)
  attachEdgeTooltip(state, surface, pathEl, edge)
  surface.edgeLayer.appendChild(pathEl)
}

function renderGraphEdges<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  clearChildren(surface.edgeLayer)
  clearChildren(surface.defs)
  const markerByKey = new Map<string, string>()
  state.layout.edges.forEach((edge) => renderGraphEdge(state, surface, edge, markerByKey))
}

function describeEventTarget(
  target: EventTarget | null,
): { tagName: string; className: string; graphNode: string } | null {
  if (!(target instanceof Element)) return null
  return {
    tagName: target.tagName,
    className: target.getAttribute('class') ?? '',
    graphNode: target.getAttribute('data-graph-node') ?? '',
  }
}

function dispatchNodeDoubleClick<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  source: 'native-dblclick' | 'click-fallback' | 'pointerdown-fallback',
  evt: MouseEvent,
): void {
  const now = performance.now()
  if (
    state.lastDoubleClickDispatch?.nodeId === node.id &&
    now - state.lastDoubleClickDispatch.time < 300
  ) {
    return
  }
  state.lastDoubleClickDispatch = { nodeId: node.id, time: now }
  state.suppressClickForNodeId = node.id
  console.info('[modelica-diagram][dblclick] graph renderer dispatch', {
    source,
    nodeId: node.id,
    label: node.label,
    detail: evt.detail,
    target: describeEventTarget(evt.target),
  })
  state.options.onNodeDoubleClick?.(node)
}

function attachNodeContextMenuHandler<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  target: Element,
): void {
  if (!state.options.onNodeContextMenu) return
  target.addEventListener('contextmenu', (event) => {
    if (!(event instanceof MouseEvent)) return
    event.preventDefault()
    event.stopPropagation()
    state.options.onNodeContextMenu?.(node, { clientX: event.clientX, clientY: event.clientY })
  })
}

function renderNodeHtml<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  node: LayoutNode<N>,
): void {
  const html = state.options.nodeHtml?.(node)
  if (!html) return
  const host = document.createElement('div')
  applyElementStyle(host, {
    position: 'absolute',
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
    pointerEvents: state.options.nodeHtmlPointerEvents ?? 'auto',
  })
  host.dataset.graphNodeId = node.id
  attachNodeContextMenuHandler(state, node, host)
  if (typeof html === 'string') host.innerHTML = html
  else host.appendChild(html)
  surface.htmlLayer.appendChild(host)
}

function createNodeRect<N>(node: LayoutNode<N>, style: Required<NodeStyle>): SVGRectElement {
  const rect = createSvgEl('rect')
  setAttrs(rect, {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fill: style.fill,
    stroke: style.stroke,
    'stroke-width': style.strokeWidth,
    rx: style.rx,
    ry: style.ry,
  })
  rect.style.filter = glowFilter(style)
  return rect
}

function createNodeHitRect<N>(node: LayoutNode<N>, style: Required<NodeStyle>): SVGRectElement {
  const hitRect = createSvgEl('rect')
  setAttrs(hitRect, {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    fill: 'transparent',
    stroke: 'transparent',
    'stroke-width': 0,
    rx: style.rx,
    ry: style.ry,
  })
  hitRect.style.pointerEvents = 'all'
  return hitRect
}

function createNodeLabel<N>(node: LayoutNode<N>, style: Required<NodeStyle>): SVGTextElement {
  const text = createSvgEl('text')
  setAttrs(text, {
    x: node.x + 10,
    y: node.y + 28,
    fill: style.textColor,
    'font-size': style.fontSize,
    'font-family': style.fontFamily,
    'font-weight': style.fontWeight,
  })
  text.textContent = node.label ?? node.id
  return text
}

function createNodeOverlay<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
): SVGElement | null {
  const svgOverlay = state.options.nodeSvg?.(node)
  if (!svgOverlay) return null
  if (typeof svgOverlay === 'string') {
    const host = createSvgEl('g')
    host.innerHTML = svgOverlay
    return host
  }
  return svgOverlay
}

function beginNodeDrag<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  group: SVGGElement,
  evt: PointerEvent,
): void {
  if (evt.button !== 0) return
  if (state.options.onNodeDoubleClick) {
    const now = performance.now()
    const isFallbackDoubleClick =
      state.lastPointerDownForDoubleClick?.nodeId === node.id &&
      now - state.lastPointerDownForDoubleClick.time < 450
    state.lastPointerDownForDoubleClick = { nodeId: node.id, time: now }
    console.info('[modelica-diagram][dblclick] graph renderer pointerdown', {
      nodeId: node.id,
      label: node.label,
      isFallbackDoubleClick,
      target: describeEventTarget(evt.target),
    })
    if (isFallbackDoubleClick) dispatchNodeDoubleClick(state, node, 'pointerdown-fallback', evt)
  }
  evt.stopPropagation()
  state.draggedNodeId = node.id
  state.draggedOrganicNodeIds = state.organicState
    ? findUndirectedGraphNeighborhood(state.graph, node.id, ORGANIC_DRAG_NEIGHBORHOOD_HOPS)
    : undefined
  state.draggedNodeMoved = false
  state.nodeDragStart = { x: evt.clientX, y: evt.clientY, nodeX: node.x, nodeY: node.y }
  group.style.cursor = 'grabbing'
}

function attachNodeDragHandlers<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  group: SVGGElement,
): void {
  group.style.cursor = 'grab'
  group.addEventListener('pointerdown', (evt) => beginNodeDrag(state, node, group, evt))
  group.addEventListener('pointerup', () => {
    if (state.draggedNodeId !== node.id) group.style.cursor = 'grab'
  })
}

function attachNodeHoverHandlers<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  group: SVGGElement,
  rect: SVGRectElement,
  baseStyle: Required<NodeStyle>,
): void {
  const hoverStyle = state.options.nodeHoverStyle?.(node)
  if (!hoverStyle) return
  group.addEventListener('mouseenter', () => {
    const applied = mergePartialNodeStyle(baseStyle, hoverStyle)
    setAttrs(rect, {
      fill: applied.fill,
      stroke: applied.stroke,
      'stroke-width': applied.strokeWidth,
    })
    rect.style.filter = glowFilter(applied)
  })
  group.addEventListener('mouseleave', () => {
    setAttrs(rect, {
      fill: baseStyle.fill,
      stroke: baseStyle.stroke,
      'stroke-width': baseStyle.strokeWidth,
    })
    rect.style.filter = glowFilter(baseStyle)
    if (state.options.enableNodeDrag !== false) group.style.cursor = 'grab'
  })
}

function attachNodeClickHandlers<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  group: SVGGElement,
): void {
  if (!state.options.onNodeClick && !state.options.onNodeDoubleClick) return
  group.addEventListener('click', (evt) => {
    if (state.options.onNodeDoubleClick) {
      console.info('[modelica-diagram][dblclick] graph renderer click', {
        nodeId: node.id,
        label: node.label,
        detail: evt.detail,
        target: describeEventTarget(evt.target),
      })
      const now = performance.now()
      const isFallbackDoubleClick =
        state.lastClickForDoubleClick?.nodeId === node.id &&
        now - state.lastClickForDoubleClick.time < 450
      state.lastClickForDoubleClick = { nodeId: node.id, time: now }
      if (isFallbackDoubleClick) {
        dispatchNodeDoubleClick(state, node, 'click-fallback', evt)
        return
      }
    }
    if (state.suppressClickForNodeId === node.id) {
      state.suppressClickForNodeId = null
      return
    }
    state.options.onNodeClick?.(node)
  })
}

function attachNodeDoubleClickHandler<N, E>(
  state: GraphControllerState<N, E>,
  node: LayoutNode<N>,
  group: SVGGElement,
): void {
  if (!state.options.onNodeDoubleClick) return
  group.addEventListener('dblclick', (evt) =>
    dispatchNodeDoubleClick(state, node, 'native-dblclick', evt),
  )
}

function attachNodeTooltipHandler<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  node: LayoutNode<N>,
  group: SVGGElement,
): void {
  const tip = state.options.nodeTooltipHtml?.(node)
  if (!tip) return
  group.addEventListener('mousemove', (evt) =>
    showGraphTooltip(surface, tip, evt.clientX, evt.clientY),
  )
  group.addEventListener('mouseleave', () => hideGraphTooltip(surface))
}

function createNodeGroup<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  node: LayoutNode<N>,
): SVGGElement {
  const group = createSvgEl('g')
  group.setAttribute('data-graph-node', '1')
  group.setAttribute('data-graph-node-id', node.id)
  group.setAttribute('data-rendered-x', String(node.x))
  group.setAttribute('data-rendered-y', String(node.y))
  const baseStyle = mergeNodeStyle(state.options.theme, node)
  const style = mergePartialNodeStyle(baseStyle, state.options.nodeStyle?.(node))
  const rect = createNodeRect(node, style)
  group.append(rect)
  const overlay = createNodeOverlay(state, node)
  if (overlay) group.append(overlay)
  if (state.options.showDefaultNodeLabel !== false) group.append(createNodeLabel(node, style))
  group.append(createNodeHitRect(node, style))
  if (state.options.enableNodeDrag !== false) attachNodeDragHandlers(state, node, group)
  attachNodeHoverHandlers(state, node, group, rect, style)
  attachNodeClickHandlers(state, node, group)
  attachNodeDoubleClickHandler(state, node, group)
  attachNodeContextMenuHandler(state, node, group)
  attachNodeTooltipHandler(state, surface, node, group)
  return group
}

function renderGraphNodes<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  clearChildren(surface.nodeLayer)
  clearChildren(surface.htmlLayer)
  state.layout.nodes.forEach((node) => {
    renderNodeHtml(state, surface, node)
    surface.nodeLayer.appendChild(createNodeGroup(state, surface, node))
  })
}

function renderGraph<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  const { width, height } = getContainerSize(surface.container)
  setAttrs(surface.svg, { viewBox: `0 0 ${width} ${height}`, width, height })
  renderGraphEdges(state, surface)
  renderGraphNodes(state, surface)
  updateSurfaceTransforms(surface, state.viewport)
}

function syncRenderedNodeTransforms<N>(
  surface: GraphSurface,
  nodeById: Map<string, LayoutNode<N>>,
  activeNodeIds?: ReadonlySet<string>,
): void {
  for (const element of surface.nodeLayer.children) {
    if (!(element instanceof SVGGElement)) continue
    const node = nodeById.get(element.dataset.graphNodeId ?? '')
    if (!node) continue
    if (activeNodeIds && !activeNodeIds.has(node.id)) continue
    const renderedX = Number(element.dataset.renderedX ?? node.x)
    const renderedY = Number(element.dataset.renderedY ?? node.y)
    setAttrs(element, { transform: `translate(${node.x - renderedX} ${node.y - renderedY})` })
  }
}

function syncRenderedEdgePaths<E>(
  surface: GraphSurface,
  edgeById: Map<string, LayoutEdge<E>>,
  activeNodeIds?: ReadonlySet<string>,
): void {
  for (const element of surface.edgeLayer.children) {
    if (!(element instanceof SVGPathElement)) continue
    const edge = edgeById.get(element.dataset.graphEdgeId ?? '')
    if (!edge) continue
    if (activeNodeIds && !activeNodeIds.has(edge.source) && !activeNodeIds.has(edge.target)) {
      continue
    }
    setAttrs(element, { d: edge.path })
  }
}

function syncRenderedHtmlPositions<N>(
  surface: GraphSurface,
  nodeById: Map<string, LayoutNode<N>>,
  activeNodeIds?: ReadonlySet<string>,
): void {
  for (const element of surface.htmlLayer.children) {
    if (!(element instanceof HTMLElement)) continue
    const node = nodeById.get(element.dataset.graphNodeId ?? '')
    if (!node) continue
    if (activeNodeIds && !activeNodeIds.has(node.id)) continue
    element.style.left = `${node.x}px`
    element.style.top = `${node.y}px`
  }
}

function syncRenderedOrganicLayout<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  activeNodeIds?: ReadonlySet<string>,
): void {
  const nodeById = new Map(state.layout.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(state.layout.edges.map((edge) => [edge.id, edge]))
  syncRenderedNodeTransforms(surface, nodeById, activeNodeIds)
  syncRenderedEdgePaths(surface, edgeById, activeNodeIds)
  syncRenderedHtmlPositions(surface, nodeById, activeNodeIds)
}

function stopOrganicLayout<N, E>(state: GraphControllerState<N, E>): void {
  state.organicState = null
  state.draggedOrganicNodeIds = undefined
  state.organicIdleFrames = 0
  if (state.organicFrame !== null) cancelAnimationFrame(state.organicFrame)
  state.organicFrame = null
}

function syncOrganicLayout<N, E>(
  state: GraphControllerState<N, E>,
  activeNodeIds?: ReadonlySet<string>,
): void {
  if (!state.organicState) return
  applyOrganicLayout(state.organicState, state.layout.nodes, activeNodeIds)
  const edges = routeOrganicEdges<N, E>(state.layout.nodes, state.graph.edges)
  state.layout = {
    ...state.layout,
    edges,
    bounds: computeLayoutBounds(state.layout.nodes, edges),
  }
}

function stepOrganicFrame<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  state.organicFrame = null
  if (!state.organicState) return
  if (state.draggedNodeId && state.draggedOrganicNodeIds) {
    const speed = stepOrganicLayout(
      state.organicState,
      ORGANIC_DRAG_ITERATIONS_PER_FRAME,
      state.draggedOrganicNodeIds,
    )
    syncOrganicLayout(state, state.draggedOrganicNodeIds)
    syncRenderedOrganicLayout(state, surface, state.draggedOrganicNodeIds)
    if (speed >= 0.08) scheduleOrganicLayout(state, surface)
    return
  }
  const speed = stepOrganicLayout(state.organicState, organicLayoutIterationsPerFrame)
  syncOrganicLayout(state)
  syncRenderedOrganicLayout(state, surface)
  state.organicIdleFrames = speed < 0.08 ? state.organicIdleFrames + 1 : 0
  if (state.organicIdleFrames < 12) scheduleOrganicLayout(state, surface)
}

function scheduleOrganicLayout<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
): void {
  if (!state.organicState || state.organicFrame !== null) return
  state.organicFrame = requestAnimationFrame(() => stepOrganicFrame(state, surface))
}

function startOrganicLayout<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  state.organicState = createOrganicLayoutState(state.layout.nodes, state.graph.edges)
  stepOrganicLayout(state.organicState, 90)
  syncOrganicLayout(state)
  state.organicIdleFrames = 0
  scheduleOrganicLayout(state, surface)
}

function relayoutGraph<N, E>(state: GraphControllerState<N, E>, surface: GraphSurface): void {
  stopOrganicLayout(state)
  state.layout = layoutGraph(state.graph, state.options)
  if (state.options.layoutMode === 'organic') startOrganicLayout(state, surface)
}

function rerouteGraphEdges<N, E>(state: GraphControllerState<N, E>): void {
  const edges =
    state.options.layoutMode === 'organic'
      ? routeOrganicEdges<N, E>(state.layout.nodes, state.graph.edges)
      : routeLayoutEdges(state.layout.nodes, state.layout.edges, state.options)
  state.layout = {
    ...state.layout,
    edges,
    bounds: computeLayoutBounds(state.layout.nodes, edges),
  }
}

function computeExportFrame<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  config?: { cropToContent?: boolean; cropPadding?: number },
): { x: number; y: number; width: number; height: number } {
  const { width, height } = getContainerSize(surface.container)
  if (!config?.cropToContent || state.layout.nodes.length === 0)
    return { x: 0, y: 0, width, height }
  const padding = Math.max(0, config.cropPadding ?? 24)
  const x = state.layout.bounds.x * state.viewport.scale + state.viewport.tx - padding
  const y = state.layout.bounds.y * state.viewport.scale + state.viewport.ty - padding
  const croppedWidth = Math.max(1, state.layout.bounds.width * state.viewport.scale + padding * 2)
  const croppedHeight = Math.max(1, state.layout.bounds.height * state.viewport.scale + padding * 2)
  return { x, y, width: croppedWidth, height: croppedHeight }
}

function appendExportedHtmlLayer<N, E>(
  clone: SVGSVGElement,
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
): void {
  if (surface.htmlLayer.childElementCount === 0) return
  const foreignLayer = createSvgEl('g')
  setAttrs(foreignLayer, { transform: viewportTransform(state.viewport) })
  Array.from(surface.htmlLayer.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return
    const foreign = createSvgEl('foreignObject')
    const left = px(child.style.left)
    const top = px(child.style.top)
    const width = px(child.style.width)
    const height = px(child.style.height)
    setAttrs(foreign, { x: left, y: top, width, height })
    const wrapper = document.createElement('div')
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    wrapper.style.width = `${width}px`
    wrapper.style.height = `${height}px`
    wrapper.style.pointerEvents = 'none'
    wrapper.innerHTML = child.innerHTML
    foreign.appendChild(wrapper)
    foreignLayer.appendChild(foreign)
  })
  clone.appendChild(foreignLayer)
}

function exportSvgClone<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  config?: GraphSvgExportOptions,
): { markup: string; width: number } {
  const serializer = new XMLSerializer()
  const clone = surface.svg.cloneNode(true) as SVGSVGElement
  const frame = computeExportFrame(state, surface, config)
  const backgroundColor = config?.backgroundColor?.trim()
  if (backgroundColor) {
    const background = createSvgEl('rect')
    setAttrs(background, {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      fill: backgroundColor,
    })
    clone.insertBefore(background, clone.firstChild)
  }
  if (config?.includeHtmlLayer !== false) appendExportedHtmlLayer(clone, state, surface)
  setAttrs(clone, {
    xmlns: SVG_NS,
    width: frame.width,
    height: frame.height,
    viewBox: `${frame.x} ${frame.y} ${frame.width} ${frame.height}`,
  })
  return { markup: serializer.serializeToString(clone), width: frame.width }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

async function copyGraphAsPng<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  config?: GraphPngExportOptions,
): Promise<boolean> {
  const requestedScale = config?.scale ?? window.devicePixelRatio ?? 1
  const scale = Math.max(1, Math.min(6, requestedScale))
  const exportConfig: GraphSvgExportOptions = {
    ...(config?.cropToContent !== undefined ? { cropToContent: config.cropToContent } : {}),
    ...(config?.cropPadding !== undefined ? { cropPadding: config.cropPadding } : {}),
    ...(config?.backgroundColor !== undefined ? { backgroundColor: config.backgroundColor } : {}),
  }
  const exported = exportSvgClone(state, surface, exportConfig)
  const pngBytes = await svgStringToPngUint8(exported.markup, Math.ceil(exported.width * scale))
  const pngBlob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' })
  const clipboardItemCtor = (window as Window & { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem
  if (navigator.clipboard?.write && clipboardItemCtor) {
    await navigator.clipboard.write([new clipboardItemCtor({ 'image/png': pngBlob })])
    return true
  }
  downloadBlob(pngBlob, 'graph.png')
  return false
}

function downloadGraphSvg<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  fileName = 'graph.svg',
): void {
  const markup = exportSvgClone(state, surface).markup
  downloadBlob(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), fileName)
}

function handleGraphPointerDown<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: PointerEvent,
): void {
  if (state.draggedNodeId) return
  if (evt.button !== 0 || state.options.enablePanZoom === false) return
  if (evt.target instanceof SVGElement && evt.target.closest('[data-graph-node="1"]')) return
  state.isDragging = true
  state.dragStart = { x: evt.clientX, y: evt.clientY, tx: state.viewport.tx, ty: state.viewport.ty }
  surface.svg.setPointerCapture(evt.pointerId)
}

function handleNodeDragMove<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: PointerEvent,
  render: () => void,
): boolean {
  if (!state.draggedNodeId) return false
  const node = state.layout.nodes.find((candidate) => candidate.id === state.draggedNodeId)
  if (!node) return true
  if (!state.draggedNodeMoved) {
    const movedPastThreshold =
      Math.abs(evt.clientX - state.nodeDragStart.x) > 3 ||
      Math.abs(evt.clientY - state.nodeDragStart.y) > 3
    if (!movedPastThreshold) return true
    state.draggedNodeMoved = true
    surface.svg.setPointerCapture(evt.pointerId)
  }
  const dx = (evt.clientX - state.nodeDragStart.x) / state.viewport.scale
  const dy = (evt.clientY - state.nodeDragStart.y) / state.viewport.scale
  node.x = state.nodeDragStart.nodeX + dx
  node.y = state.nodeDragStart.nodeY + dy
  if (state.organicState) {
    moveOrganicNode(state.organicState, node.id, {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    })
    state.organicIdleFrames = 0
    scheduleOrganicLayout(state, surface)
    return true
  }
  rerouteGraphEdges(state)
  render()
  return true
}

function handleGraphPointerMove<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: PointerEvent,
  render: () => void,
): void {
  if (state.draggedNodeId) {
    handleNodeDragMove(state, surface, evt, render)
    return
  }
  if (!state.isDragging) return
  state.viewport = {
    ...state.viewport,
    tx: state.dragStart.tx + (evt.clientX - state.dragStart.x),
    ty: state.dragStart.ty + (evt.clientY - state.dragStart.y),
  }
  updateSurfaceTransforms(surface, state.viewport)
}

function handleNodeDragRelease<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: PointerEvent,
): boolean {
  if (!state.draggedNodeId) return false
  const releasedNodeId = state.draggedNodeId
  if (state.draggedNodeMoved) state.suppressClickForNodeId = state.draggedNodeId
  state.draggedNodeId = null
  state.draggedOrganicNodeIds = undefined
  state.draggedNodeMoved = false
  if (state.organicState) {
    releaseOrganicNode(state.organicState, releasedNodeId)
    state.organicIdleFrames = 0
    scheduleOrganicLayout(state, surface)
  }
  if (surface.svg.hasPointerCapture(evt.pointerId)) {
    surface.svg.releasePointerCapture(evt.pointerId)
  }
  const groups = surface.nodeLayer.querySelectorAll('g')
  groups.forEach((group) => {
    group.style.cursor = state.options.enableNodeDrag !== false ? 'grab' : 'default'
  })
  return true
}

function handleGraphPointerUp<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: PointerEvent,
): void {
  if (handleNodeDragRelease(state, surface, evt)) return
  if (!state.isDragging) return
  state.isDragging = false
  surface.svg.releasePointerCapture(evt.pointerId)
  emitViewportChange(state)
}

function handleGraphWheel<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  evt: WheelEvent,
): void {
  if (state.options.enablePanZoom === false) return
  evt.preventDefault()
  const rect = surface.svg.getBoundingClientRect()
  state.viewport = applyWheelZoom(state.viewport, {
    deltaY: evt.deltaY,
    anchorX: evt.clientX - rect.left,
    anchorY: evt.clientY - rect.top,
    minZoom: state.options.minZoom ?? 0.2,
    maxZoom: state.options.maxZoom ?? 3.5,
    step: state.options.zoomStep ?? 0.12,
  })
  updateSurfaceTransforms(surface, state.viewport)
  emitViewportChange(state)
}

function createGraphState<N, E>(
  graph: GraphData<N, E>,
  options: RenderOptions<N, E>,
): GraphControllerState<N, E> {
  return {
    graph,
    options,
    layout: layoutGraph(graph, options),
    viewport: options.initialViewport ?? initialViewportState(),
    isDragging: false,
    dragStart: { x: 0, y: 0, tx: 0, ty: 0 },
    draggedNodeId: null,
    draggedOrganicNodeIds: undefined,
    suppressClickForNodeId: null,
    draggedNodeMoved: false,
    nodeDragStart: { x: 0, y: 0, nodeX: 0, nodeY: 0 },
    lastClickForDoubleClick: null,
    lastPointerDownForDoubleClick: null,
    lastDoubleClickDispatch: null,
    organicState: null,
    organicFrame: null,
    organicIdleFrames: 0,
  }
}

function destroyGraphController<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  handlers: GraphEventHandlers,
): void {
  stopOrganicLayout(state)
  surface.svg.removeEventListener('pointerdown', handlers.pointerdown)
  surface.svg.removeEventListener('pointermove', handlers.pointermove)
  surface.svg.removeEventListener('pointerup', handlers.pointerup)
  surface.svg.removeEventListener('wheel', handlers.wheel)
  hideGraphTooltip(surface)
  surface.container.removeChild(surface.svg)
  surface.container.removeChild(surface.htmlLayer)
  surface.container.removeChild(surface.tooltip)
}

function createGraphControllerApi<N, E>(
  state: GraphControllerState<N, E>,
  surface: GraphSurface,
  handlers: GraphEventHandlers,
  render: () => void,
): GraphController<N, E> {
  return {
    setGraph: (graph) => {
      state.graph = graph
      relayoutGraph(state, surface)
      fitGraphToContainer(state, surface)
      render()
    },
    setOptions: (options) => {
      state.options = options
      relayoutGraph(state, surface)
      fitGraphToContainer(state, surface)
      render()
    },
    redraw: render,
    resize: render,
    fit: () => fitGraphToContainer(state, surface),
    focusNode: (nodeId) => focusGraphNode(state, surface, nodeId),
    setViewport: (viewport) => {
      state.viewport = viewport
      updateSurfaceTransforms(surface, viewport)
    },
    copyAsPng: (options) => copyGraphAsPng(state, surface, options),
    exportSvgString: (options) => exportSvgClone(state, surface, options).markup,
    downloadSvg: (fileName) => downloadGraphSvg(state, surface, fileName),
    destroy: () => destroyGraphController(state, surface, handlers),
  }
}

export const createGraphController = <N = unknown, E = unknown>(
  container: HTMLElement,
  initialGraph: GraphData<N, E>,
  initialOptions: RenderOptions<N, E> = {},
): GraphController<N, E> => {
  const surface = createGraphSurface(container)
  const state = createGraphState(initialGraph, initialOptions)
  const render = () => renderGraph(state, surface)
  const handlers: GraphEventHandlers = {
    pointerdown: (evt) => handleGraphPointerDown(state, surface, evt),
    pointermove: (evt) => handleGraphPointerMove(state, surface, evt, render),
    pointerup: (evt) => handleGraphPointerUp(state, surface, evt),
    wheel: (evt) => handleGraphWheel(state, surface, evt),
  }
  surface.svg.addEventListener('pointerdown', handlers.pointerdown)
  surface.svg.addEventListener('pointermove', handlers.pointermove)
  surface.svg.addEventListener('pointerup', handlers.pointerup)
  surface.svg.addEventListener('wheel', handlers.wheel, { passive: false })
  relayoutGraph(state, surface)
  if (initialOptions.initialViewport) updateSurfaceTransforms(surface, state.viewport)
  else fitGraphToContainer(state, surface)
  render()
  return createGraphControllerApi(state, surface, handlers, render)
}
