<template>
  <div class="modelica-diagram-pane">
    <div v-if="viewMode === 'diagram'" class="row items-center q-gutter-xs q-pa-xs">
      <q-btn-toggle
        v-model="layoutMode"
        dense
        no-caps
        flat
        text-color="grey-7"
        :options="[
          { label: 'Authored', value: 'authored' },
          { label: 'Auto', value: 'auto' },
        ]"
      />
      <ToggleButton v-model="showLabels" dense flat no-caps color="grey-7" label="Labels" />
      <ToggleButton
        v-model="showModelicaNativeLabels"
        dense
        flat
        no-caps
        color="grey-7"
        label="Modelica Labels"
      />
      <ToggleButton
        v-model="showLibraryPaths"
        dense
        flat
        no-caps
        color="grey-7"
        label="Library Paths"
      />
      <q-btn
        dense
        flat
        no-caps
        :color="showBlockHints ? 'primary' : 'grey-7'"
        :label="showBlockHints ? 'Block Hints On' : 'Block Hints Off'"
        @click="showBlockHints = !showBlockHints"
      />
      <q-btn
        dense
        flat
        color="grey-7"
        label="Zoom to Fit"
        :disable="!hasGraph"
        @click="onZoomToFit"
      />
      <q-space />
      <q-btn
        dense
        flat
        color="grey-7"
        label="Copy PNG"
        :disable="!hasGraph || exportingPng"
        @click="onCopyPng"
      />
      <q-btn
        dense
        flat
        color="grey-7"
        label="Export SVG"
        :disable="!hasGraph"
        @click="onExportSvg"
      />
    </div>

    <div v-if="errorText" class="q-px-sm q-pb-xs text-negative text-caption">{{ errorText }}</div>
    <div v-else-if="loading" class="q-px-sm q-pb-xs text-grey-7 text-caption">Loading diagram…</div>

    <div v-if="viewMode === 'diagram'" ref="containerRef" class="diagram-canvas"></div>
    <div v-else class="q-pa-sm fit">
      <SanitizedMarkup
        v-if="classIconMarkup"
        class="class-icon-view"
        :markup="classIconMarkup"
        :sanitize="sanitizeSvgMarkup"
      />
      <div v-else class="text-caption text-grey-7">No icon available for this class.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { sanitizeSvgMarkup } from '../../spaceships/sanitizeSvgMarkup'
import ToggleButton from '../../components/ToggleButton.vue'
import SanitizedMarkup from './SanitizedMarkup.vue'
import {
  createGraphController,
  type GraphData,
  type LayoutEdge,
  type LayoutNode,
  type NodeStyle,
  type RenderOptions,
} from '../../modules/graph'
import {
  mapDiagramToGraph,
  type DiagramEdgeData,
  type DiagramNodeData,
} from '../diagram/mapDiagramToGraph'
import type { DiagramColor, DiagramIconGraphic, DiagramIconSpec } from '../diagram/types'
import type {
  DiagramLayoutMode,
  ModelicaDiagramDto,
  ModelicaDiagramExtractor,
} from '../diagram/types'

const props = defineProps<{
  extractor: ModelicaDiagramExtractor
  source: string
  qualifiedName?: string | null
  wasmLoaded: boolean
  refreshKey?: string | number | null
  viewMode?: 'diagram' | 'icon'
}>()

const emptyGraph: GraphData<DiagramNodeData, DiagramEdgeData> = { nodes: [], edges: [] }
const emptyOptions: RenderOptions<DiagramNodeData, DiagramEdgeData> = {}

const containerRef = ref<HTMLElement | null>(null)
const diagram = ref<ModelicaDiagramDto | null>(null)
const layoutMode = ref<DiagramLayoutMode>('authored')
const viewMode = computed<'diagram' | 'icon'>(() => props.viewMode ?? 'diagram')
const showLabels = ref(true)
const showModelicaNativeLabels = ref(true)
const showLibraryPaths = ref(false)
const showBlockHints = ref(false)
const loading = ref(false)
const errorText = ref('')
const exportingPng = ref(false)

const hasGraph = computed(() => Boolean(diagram.value && diagram.value.components.length > 0))

const mapped = computed(() =>
  diagram.value
    ? mapDiagramToGraph(diagram.value, layoutMode.value)
    : { graph: emptyGraph, options: emptyOptions },
)

const stableStringify = (value: unknown): string => {
  if (value == null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(typeof value)
}

const hashString = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const diagramIrHash = computed(() => hashString(stableStringify(mapped.value.graph)))

const colorToCss = (color: DiagramColor | undefined, fallback: string): string =>
  color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : fallback

const iconNodeStyle = (
  node: LayoutNode<DiagramNodeData>,
  hintsEnabled: boolean,
): NodeStyle | undefined => {
  if (!node.data?.hasIcon) return undefined
  if (hintsEnabled) {
    return {
      fill: 'rgba(148, 163, 184, 0.14)',
      stroke: 'rgba(100, 116, 139, 0.45)',
      strokeWidth: 1,
    }
  }
  return {
    fill: 'rgba(0, 0, 0, 0)',
    stroke: 'rgba(0, 0, 0, 0)',
    strokeWidth: 0.8,
  }
}

const iconNodeHoverStyle = (node: LayoutNode<DiagramNodeData>): NodeStyle | undefined => {
  if (!node.data?.hasIcon) return undefined
  return {
    fill: 'rgba(148, 163, 184, 0.18)',
    stroke: 'rgba(100, 116, 139, 0.5)',
    strokeWidth: 1,
  }
}

const runtimeOptions = computed<RenderOptions<DiagramNodeData, DiagramEdgeData>>(() => {
  const labelsEnabled = showLabels.value
  const nativeLabelsEnabled = showModelicaNativeLabels.value
  const libraryPathsEnabled = showLibraryPaths.value
  const hintsEnabled = showBlockHints.value
  return {
    ...mapped.value.options,
    showDefaultNodeLabel: false,
    nodeTooltipHtml: (node: LayoutNode<DiagramNodeData>) =>
      `<div><strong>${node.label ?? node.id}</strong><div>${node.data?.typeName ?? ''}</div></div>`,
    edgeTooltipHtml: (edge: LayoutEdge<DiagramEdgeData>) => `<div>${edge.id}</div>`,
    nodeStyle: (node: LayoutNode<DiagramNodeData>) => iconNodeStyle(node, hintsEnabled),
    nodeHoverStyle: (node: LayoutNode<DiagramNodeData>) => iconNodeHoverStyle(node),
    edgeStyle: (edge: LayoutEdge<DiagramEdgeData>) =>
      edge.data?.color
        ? { stroke: colorToCss(edge.data.color, 'rgba(55, 65, 81, 0.95)') }
        : undefined,
    nodeSvg: (node: LayoutNode<DiagramNodeData>) =>
      renderNodeSvg(node, labelsEnabled, nativeLabelsEnabled, libraryPathsEnabled),
  }
})

const classIconMarkup = computed(() => {
  const icon = diagram.value?.classIcon
  if (!icon || !Array.isArray(icon.graphics) || icon.graphics.length === 0) return ''
  return renderIconSvg(
    icon,
    { x: 0, y: 0, width: 420, height: 420 },
    props.qualifiedName ?? 'Model',
    undefined,
    true,
    false,
    false,
  ).markup
})

let controller: ReturnType<typeof createGraphController<DiagramNodeData, DiagramEdgeData>> | null =
  null
let resizeObserver: ResizeObserver | null = null
let lastAppliedGraphHash = ''

const derivedFileName = (qualifiedName: string | null | undefined): string => {
  if (!qualifiedName) return 'Model.mo'
  const normalized = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
  return normalized ? `${normalized}.mo` : 'Model.mo'
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const normalizeExtent = (
  extent: [[number, number], [number, number]] | undefined,
): { minX: number; maxX: number; minY: number; maxY: number } => {
  const e = extent ?? [
    [-100, 100],
    [100, -100],
  ]
  return {
    minX: Math.min(e[0][0], e[1][0]),
    maxX: Math.max(e[0][0], e[1][0]),
    minY: Math.min(e[0][1], e[1][1]),
    maxY: Math.max(e[0][1], e[1][1]),
  }
}

const flipY = (y: number, minY: number, maxY: number): number => minY + maxY - y

const toSvgPoint = (
  p: [number, number],
  extent: { minY: number; maxY: number },
): { x: number; y: number } => ({ x: p[0], y: flipY(p[1], extent.minY, extent.maxY) })

const toSvgVector = (
  p: [number, number],
  extent: { minY: number; maxY: number },
): { x: number; y: number } => {
  const zero = toSvgPoint([0, 0], extent)
  const point = toSvgPoint(p, extent)
  return { x: point.x - zero.x, y: point.y - zero.y }
}

const strokeWidthFromThickness = (thickness: number | undefined): number => {
  if (thickness == null || !Number.isFinite(thickness)) return 2
  return Math.max(0.8, thickness * 3)
}

const normalizeFillPattern = (value: string | undefined): string => {
  if (!value) return ''
  const raw = value.trim()
  if (!raw) return ''
  const tail = raw.split('.').pop() ?? raw
  return tail.toLowerCase()
}

const graphicBounds = (
  graphic: DiagramIconGraphic,
): { minX: number; maxX: number; minY: number; maxY: number } | null => {
  if (graphic.kind === 'Rectangle' || graphic.kind === 'Ellipse') {
    const normalized = normalizeExtent(graphic.extent)
    return normalized
  }
  if (graphic.kind === 'Line' || graphic.kind === 'Polygon') {
    if (graphic.points.length === 0) return null
    return {
      minX: Math.min(...graphic.points.map((point) => point[0])),
      maxX: Math.max(...graphic.points.map((point) => point[0])),
      minY: Math.min(...graphic.points.map((point) => point[1])),
      maxY: Math.max(...graphic.points.map((point) => point[1])),
    }
  }
  if (!graphic.extent) return null
  return normalizeExtent(graphic.extent)
}

const iconRenderExtent = (
  icon: DiagramIconSpec,
): { minX: number; maxX: number; minY: number; maxY: number } => {
  const coordinate = normalizeExtent(icon.coordinateExtent)
  let minX = coordinate.minX
  let maxX = coordinate.maxX
  let minY = coordinate.minY
  let maxY = coordinate.maxY
  icon.graphics.forEach((graphic) => {
    if (graphic.visible === false) return
    const bounds = graphicBounds(graphic)
    if (!bounds) return
    minX = Math.min(minX, bounds.minX)
    maxX = Math.max(maxX, bounds.maxX)
    minY = Math.min(minY, bounds.minY)
    maxY = Math.max(maxY, bounds.maxY)
  })
  return {
    minX: minX - 2,
    maxX: maxX + 2,
    minY: minY - 2,
    maxY: maxY + 2,
  }
}

const resolvePlaceholderValue = (
  key: string,
  componentName: string | undefined,
  iconValues: Record<string, string> | undefined,
): string => {
  const normalized = key.trim().toLowerCase()
  if (normalized === 'name') return componentName ?? ''
  if (!iconValues) return ''
  const direct = iconValues[key]
  if (direct != null) return direct
  const match = Object.entries(iconValues).find(
    ([candidate]) => candidate.toLowerCase() === normalized,
  )
  return match?.[1] ?? ''
}

const substituteModelicaText = (
  rawText: string,
  componentName: string | undefined,
  iconValues: Record<string, string> | undefined,
  nativeLabelsEnabled: boolean,
): { text: string; containsName: boolean } => {
  const placeholderPattern = /%([A-Za-z_][A-Za-z0-9_]*)/g
  const hasPlaceholders = placeholderPattern.test(rawText)
  if (!hasPlaceholders) return { text: rawText, containsName: false }
  if (!nativeLabelsEnabled)
    return { text: '', containsName: rawText.toLowerCase().includes('%name') }
  let containsName = false
  const substituted = rawText.replace(placeholderPattern, (_match, key: string) => {
    if (key.toLowerCase() === 'name') containsName = true
    return resolvePlaceholderValue(key, componentName, iconValues)
  })
  return { text: substituted, containsName }
}

const iconPatternDefs = (icon: DiagramIconSpec, patternPrefix: string): Map<number, string> => {
  const defs = new Map<number, string>()
  icon.graphics.forEach((graphic, index) => {
    const normalized = normalizeFillPattern(
      graphic.kind === 'Rectangle' || graphic.kind === 'Ellipse' || graphic.kind === 'Polygon'
        ? graphic.fillPattern
        : undefined,
    )
    if (!normalized || normalized === 'solid' || normalized === 'none') return
    const id = `${patternPrefix}-${index}`
    const base = colorToCss(
      graphic.kind === 'Rectangle' || graphic.kind === 'Ellipse' || graphic.kind === 'Polygon'
        ? graphic.fillColor
        : undefined,
      'rgb(229, 231, 235)',
    )
    const stroke = colorToCss(
      graphic.kind === 'Rectangle' || graphic.kind === 'Ellipse' || graphic.kind === 'Polygon'
        ? graphic.lineColor
        : undefined,
      'rgb(75, 85, 99)',
    )
    const backward =
      normalized.includes('backward') ||
      normalized.includes('diag') ||
      normalized.includes('crossdiag')
    const forward = normalized.includes('forward') || normalized.includes('crossdiag')
    const horizontal = normalized.includes('horizontal') || normalized === 'cross'
    const vertical = normalized.includes('vertical') || normalized === 'cross'
    const lines = [
      backward ? '<path d="M-4,12 L12,-4 M0,16 L16,0 M4,20 L20,4" />' : '',
      forward ? '<path d="M-4,-4 L12,12 M0,-8 L16,8 M4,-12 L20,4" />' : '',
      horizontal ? '<path d="M-4,4 L20,4 M-4,8 L20,8 M-4,12 L20,12" />' : '',
      vertical ? '<path d="M4,-4 L4,20 M8,-4 L8,20 M12,-4 L12,20" />' : '',
    ]
      .filter((line) => line.length > 0)
      .join('')
    if (!lines) return
    defs.set(
      index,
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="16" height="16"><rect width="16" height="16" fill="${base}" /><g stroke="${stroke}" stroke-width="1">${lines}</g></pattern>`,
    )
  })
  return defs
}

const wrapGraphicWithTransform = (
  markup: string,
  graphic: DiagramIconGraphic,
  extent: { minY: number; maxY: number },
): string => {
  if (graphic.visible === false) return ''
  const origin = graphic.origin
  const rotation = graphic.rotation
  if (!origin && (rotation == null || Math.abs(rotation) < 1e-6)) return markup
  const translate = origin ? toSvgVector(origin, extent) : { x: 0, y: 0 }
  const center = origin ? toSvgPoint(origin, extent) : toSvgPoint([0, 0], extent)
  const parts: string[] = []
  if (Math.abs(translate.x) > 1e-6 || Math.abs(translate.y) > 1e-6) {
    parts.push(`translate(${translate.x} ${translate.y})`)
  }
  if (rotation != null && Math.abs(rotation) > 1e-6) {
    parts.push(`rotate(${-rotation} ${center.x} ${center.y})`)
  }
  if (parts.length === 0) return markup
  return `<g transform="${parts.join(' ')}">${markup}</g>`
}

const renderGraphic = (
  graphic: DiagramIconGraphic,
  extent: { minY: number; maxY: number },
  componentName?: string,
  iconValues?: Record<string, string>,
  nativeLabelsEnabled = true,
  flipX = false,
  flipYValue = false,
  fillPatternId?: string,
): { markup: string; rendersName: boolean } => {
  if (graphic.kind === 'Rectangle') {
    const a = toSvgPoint(graphic.extent[0], extent)
    const b = toSvgPoint(graphic.extent[1], extent)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const width = Math.abs(a.x - b.x)
    const height = Math.abs(a.y - b.y)
    const fill = fillPatternId ? `url(#${fillPatternId})` : colorToCss(graphic.fillColor, 'none')
    const markup = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${colorToCss(graphic.lineColor, 'rgb(55,65,81)')}" stroke-width="${strokeWidthFromThickness(graphic.lineThickness)}" />`
    return { markup: wrapGraphicWithTransform(markup, graphic, extent), rendersName: false }
  }
  if (graphic.kind === 'Ellipse') {
    const a = toSvgPoint(graphic.extent[0], extent)
    const b = toSvgPoint(graphic.extent[1], extent)
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    const rx = Math.abs(a.x - b.x) / 2
    const ry = Math.abs(a.y - b.y) / 2
    const fill = fillPatternId ? `url(#${fillPatternId})` : colorToCss(graphic.fillColor, 'none')
    const markup = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${colorToCss(graphic.lineColor, 'rgb(55,65,81)')}" stroke-width="${strokeWidthFromThickness(graphic.lineThickness)}" />`
    return { markup: wrapGraphicWithTransform(markup, graphic, extent), rendersName: false }
  }
  if (graphic.kind === 'Line') {
    const points = graphic.points.map((point) => toSvgPoint(point, extent))
    const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(' ')
    const markup = `<polyline fill="none" stroke="${colorToCss(graphic.color, 'rgb(55,65,81)')}" stroke-width="${strokeWidthFromThickness(graphic.lineThickness)}" points="${pointsAttr}" />`
    return { markup: wrapGraphicWithTransform(markup, graphic, extent), rendersName: false }
  }
  if (graphic.kind === 'Polygon') {
    const points = graphic.points.map((point) => toSvgPoint(point, extent))
    const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(' ')
    const fill = fillPatternId ? `url(#${fillPatternId})` : colorToCss(graphic.fillColor, 'none')
    const markup = `<polygon fill="${fill}" stroke="${colorToCss(graphic.lineColor, 'rgb(55,65,81)')}" stroke-width="${strokeWidthFromThickness(graphic.lineThickness)}" points="${pointsAttr}" />`
    return { markup: wrapGraphicWithTransform(markup, graphic, extent), rendersName: false }
  }
  const substituted = substituteModelicaText(
    graphic.textString,
    componentName,
    iconValues,
    nativeLabelsEnabled,
  )
  const textWithComponentName = substituted.text
  const textExtent = graphic.extent ? normalizeExtent(graphic.extent) : normalizeExtent(undefined)
  const cx = (textExtent.minX + textExtent.maxX) / 2
  const cy = flipY((textExtent.minY + textExtent.maxY) / 2, extent.minY, extent.maxY)
  const textMarkup = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${colorToCss(graphic.textColor, 'rgb(31,41,55)')}" font-size="20">${escapeHtml(textWithComponentName)}</text>`
  const needsMirrorCompensation = flipX || flipYValue
  const scaleX = flipX ? -1 : 1
  const scaleY = flipYValue ? -1 : 1
  const markup = needsMirrorCompensation
    ? `<g transform="translate(${cx} ${cy}) scale(${scaleX} ${scaleY}) translate(${-cx} ${-cy})">${textMarkup}</g>`
    : textMarkup
  return {
    markup: wrapGraphicWithTransform(markup, graphic, extent),
    rendersName:
      graphic.visible !== false &&
      nativeLabelsEnabled &&
      substituted.containsName &&
      textWithComponentName.trim().length > 0,
  }
}

const renderIconSvg = (
  icon: DiagramIconSpec | undefined,
  bounds: { x: number; y: number; width: number; height: number },
  componentName?: string,
  iconValues?: Record<string, string>,
  nativeLabelsEnabled = true,
  nodeFlipX = false,
  nodeFlipY = false,
): { markup: string; rendersName: boolean } => {
  if (!icon || icon.graphics.length === 0) return { markup: '', rendersName: false }
  const coordinateExtent = normalizeExtent(icon.coordinateExtent)
  const renderExtent = iconRenderExtent(icon)
  const viewWidth = Math.max(1, renderExtent.maxX - renderExtent.minX)
  const viewHeight = Math.max(1, renderExtent.maxY - renderExtent.minY)
  const patternPrefix =
    `modelica-fill-${Math.round(bounds.x)}-${Math.round(bounds.y)}-${Math.round(bounds.width)}-${Math.round(bounds.height)}`.replaceAll(
      '.',
      '_',
    )
  const patternDefs = iconPatternDefs(icon, patternPrefix)
  const renderedGraphics = icon.graphics.map((graphic, index) =>
    renderGraphic(
      graphic,
      coordinateExtent,
      componentName,
      iconValues,
      nativeLabelsEnabled,
      nodeFlipX,
      nodeFlipY,
      patternDefs.has(index) ? `${patternPrefix}-${index}` : undefined,
    ),
  )
  const primitives = renderedGraphics.map((entry) => entry.markup).join('')
  const defs =
    patternDefs.size > 0 ? `<defs>${Array.from(patternDefs.values()).join('')}</defs>` : ''
  return {
    markup: `<svg x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" viewBox="${renderExtent.minX} ${renderExtent.minY} ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet" class="modelica-icon-svg">${defs}${primitives}</svg>`,
    rendersName: renderedGraphics.some((entry) => entry.rendersName),
  }
}

const renderPortSvg = (
  port: DiagramNodeData['ports'][number],
  node: LayoutNode<DiagramNodeData>,
): string => {
  const width = node.width * port.widthRatio
  const height = node.height * port.heightRatio
  const x = node.x + node.width * port.xRatio - width / 2
  const y = node.y + node.height * port.yRatio - height / 2
  const iconMarkup = renderIconSvg(port.icon, { x, y, width, height }, port.name).markup
  if (iconMarkup) return iconMarkup
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(255,255,255,0.92)" stroke="rgba(37,99,235,0.7)" stroke-width="1" />`
}

const renderNodeSvg = (
  node: LayoutNode<DiagramNodeData>,
  labelsEnabled: boolean,
  nativeLabelsEnabled: boolean,
  libraryPathsEnabled: boolean,
): string => {
  const label = escapeHtml(node.label ?? node.id)
  const description = escapeHtml(node.data?.description ?? '')
  const typeName = escapeHtml(node.data?.typeName ?? '')
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  if (node.data?.hasIcon) {
    const iconRender = renderIconSvg(
      node.data?.icon,
      {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      },
      node.label ?? node.id,
      node.data?.iconValues,
      nativeLabelsEnabled,
      node.data?.flipX ?? false,
      node.data?.flipY ?? false,
    )
    const ports = (node.data?.ports ?? []).map((port) => renderPortSvg(port, node)).join('')
    const rotation = node.data?.instanceRotation ?? 0
    const scaleX = node.data?.flipX ? -1 : 1
    const scaleY = node.data?.flipY ? -1 : 1
    const transform = `translate(${centerX} ${centerY}) rotate(${-rotation}) scale(${scaleX} ${scaleY}) translate(${-centerX} ${-centerY})`
    const shouldRenderExternalLabel =
      labelsEnabled && (!nativeLabelsEnabled || !iconRender.rendersName)
    const labelOut = shouldRenderExternalLabel
      ? `<text x="${centerX}" y="${node.y + node.height + 16}" text-anchor="middle" dominant-baseline="middle" fill="rgb(17 24 39)" font-size="12" font-weight="700">${label}</text>`
      : ''
    return `<g transform="${transform}">${iconRender.markup}${ports}</g>${labelOut}`
  }
  if (!labelsEnabled) return ''
  if (!libraryPathsEnabled) {
    return `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" fill="rgb(17 24 39)" font-size="12" font-weight="700">${label}</text>`
  }
  return `<text x="${centerX}" y="${centerY - 6}" text-anchor="middle" dominant-baseline="middle" fill="rgb(17 24 39)" font-size="12" font-weight="700">${label}</text><text x="${centerX}" y="${centerY + 10}" text-anchor="middle" dominant-baseline="middle" fill="rgb(75 85 99)" font-size="10">${description || typeName}</text>`
}

const loadDiagram = async () => {
  if (!props.wasmLoaded || !props.source.trim()) {
    diagram.value = null
    errorText.value = ''
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const request: { source: string; qualifiedName?: string | null; fileName: string } = {
      source: props.source,
      fileName: derivedFileName(props.qualifiedName),
    }
    if (props.qualifiedName != null) request.qualifiedName = props.qualifiedName
    diagram.value = await props.extractor.extract(request)
    const components = Array.isArray(diagram.value?.components) ? diagram.value.components : []
    const missingIcons = components
      .filter((component) => !component.icon || !Array.isArray(component.icon.graphics))
      .map((component) => ({ id: component.id, typeName: component.typeName }))
    console.info('[diagram][pane] extracted', {
      qualifiedName: props.qualifiedName ?? 'unknown',
      components: components.length,
      connections: Array.isArray(diagram.value?.connections) ? diagram.value.connections.length : 0,
      missingIcons,
    })
  } catch (error) {
    diagram.value = null
    errorText.value = (error as Error).message || 'Failed to build block diagram'
  } finally {
    loading.value = false
  }
}

watchDebounced(
  () => [props.source, props.qualifiedName, props.wasmLoaded, props.refreshKey],
  async () => {
    await loadDiagram()
  },
  { debounce: 350, maxWait: 900, immediate: true },
)

watch(
  [diagramIrHash, runtimeOptions],
  () => {
    if (!controller) return
    if (diagramIrHash.value !== lastAppliedGraphHash) {
      controller.setGraph(mapped.value.graph)
      lastAppliedGraphHash = diagramIrHash.value
    }
    controller.setOptions(runtimeOptions.value)
  },
)

const onCopyPng = async () => {
  if (!controller || exportingPng.value || !hasGraph.value) return
  exportingPng.value = true
  try {
    await controller.copyAsPng({
      scale: 4,
      cropToContent: true,
      cropPadding: 18,
      backgroundColor: 'rgb(229, 231, 235)',
    })
  } catch (error) {
    console.error('Failed to export Modelica diagram as PNG', error)
  } finally {
    exportingPng.value = false
  }
}

const onExportSvg = () => {
  if (!controller || !hasGraph.value) return
  controller.downloadSvg('modelica-diagram.svg')
}

const onZoomToFit = () => {
  if (!controller || !hasGraph.value) return
  controller.fit()
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return
  controller = createGraphController(container, mapped.value.graph, runtimeOptions.value)
  lastAppliedGraphHash = diagramIrHash.value
  resizeObserver = new ResizeObserver(() => controller?.resize())
  resizeObserver.observe(container)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  controller?.destroy()
  controller = null
})
</script>

<style scoped>
.modelica-diagram-pane {
  width: 100%;
  height: 100%;
  background: rgb(229 231 235);
}

.diagram-canvas {
  width: 100%;
  height: 100%;
  min-height: 460px;
  background: rgb(229 231 235);
}

.class-icon-view {
  width: min(100%, 520px);
  height: min(100%, 520px);
}

:deep(.diagram-node-html) {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

:deep(.diagram-node-html--icon) {
  position: relative;
  overflow: visible;
}

:deep(.diagram-node-icon-box) {
  position: relative;
  width: 100%;
  height: 100%;
}

:deep(.diagram-node-icon-content) {
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: center center;
}

:deep(.modelica-icon-svg) {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

:deep(.diagram-node-port) {
  position: absolute;
  pointer-events: none;
}

:deep(.diagram-node-port-fallback) {
  width: 100%;
  height: 100%;
  border: 1px solid rgb(37 99 235 / 70%);
  background: rgb(255 255 255 / 92%);
  box-sizing: border-box;
}

:deep(.diagram-node-label-out) {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.2;
  color: rgb(17 24 39);
  text-align: center;
  font-weight: 700;
  white-space: nowrap;
}

:deep(.diagram-node-html--fallback) {
  display: grid;
  grid-template-rows: auto auto;
  align-content: center;
  justify-items: center;
  padding: 6px;
  box-sizing: border-box;
}

:deep(.diagram-node-label) {
  font-size: 12px;
  line-height: 1.2;
  color: rgb(17 24 39);
  text-align: center;
  font-weight: 700;
}

:deep(.diagram-node-type) {
  font-size: 10px;
  line-height: 1.2;
  color: rgb(75 85 99);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
