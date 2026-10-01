import type { GraphData, GraphNode, RenderOptions } from '@taskyon/common/modules/graph'
import type {
  DiagramColor,
  DiagramIconGraphic,
  DiagramIconSpec,
  DiagramLayoutMode,
  DiagramPlacementTransform,
  DiagramPoint,
  DiagramPort,
  ModelicaDiagramDto,
} from './types'

export type DiagramNodePortData = {
  name: string
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  icon?: DiagramIconSpec
}

export type DiagramNodeData = {
  typeName: string
  qualifiedTypeName?: string
  description: string
  iconValues: Record<string, string>
  hasIcon: boolean
  preferredWidth: number
  preferredHeight: number
  instanceRotation: number
  flipX: boolean
  flipY: boolean
  ports: DiagramNodePortData[]
  iconRef?: string
  icon?: DiagramIconSpec
}

export type DiagramEdgeData = {
  linePoints?: Array<{ x: number; y: number }>
  preferredPoints?: Array<{ x: number; y: number }>
  color?: DiagramColor
  lockPreferredPath?: boolean
  preservePreferredEndpoints?: boolean
  fromPort?: string
  toPort?: string
}

export type DiagramGraphMapped = {
  graph: GraphData<DiagramNodeData, DiagramEdgeData>
  options: RenderOptions<DiagramNodeData, DiagramEdgeData>
}

type Rect = { x: number; y: number; width: number; height: number }
type Size = { width: number; height: number }
const DIAGRAM_SCALE = 3

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))
const shortTypeName = (typeName: string): string => {
  const trimmed = typeName.trim()
  if (!trimmed) return ''
  const parts = trimmed.split('.').filter(Boolean)
  return parts.at(-1) ?? trimmed
}

const toGraphPoint = (point: DiagramPoint): { x: number; y: number } => ({
  x: point.x * DIAGRAM_SCALE,
  y: -point.y * DIAGRAM_SCALE,
})

const centerOfRect = (rect: Rect): { x: number; y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
})

const fallbackTextSize = (name: string, description: string): Size => {
  const nameWidth = name.length * 7.2 + 24
  const shortDescription = shortTypeName(description)
  const descriptionWidth = shortDescription.length * 5.6 + 20
  const width = clamp(Math.max(nameWidth, descriptionWidth, 56), 56, 120)
  return { width, height: 56 }
}

const sizeFromPlacementExtent = (
  extent: [[number, number], [number, number]] | undefined,
): Size | null => {
  if (!extent) return null
  const width = Math.max(36, Math.abs(extent[1][0] - extent[0][0]) * DIAGRAM_SCALE)
  const height = Math.max(28, Math.abs(extent[1][1] - extent[0][1]) * DIAGRAM_SCALE)
  return { width, height }
}

const graphicExtent = (
  graphic: DiagramIconGraphic,
): { minX: number; maxX: number; minY: number; maxY: number } | null => {
  if (graphic.kind === 'Rectangle' || graphic.kind === 'Ellipse') {
    const normalized = normalizeExtent(graphic.extent)
    return {
      minX: normalized[0][0],
      minY: normalized[0][1],
      maxX: normalized[1][0],
      maxY: normalized[1][1],
    }
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
  const normalized = normalizeExtent(graphic.extent)
  return {
    minX: normalized[0][0],
    minY: normalized[0][1],
    maxX: normalized[1][0],
    maxY: normalized[1][1],
  }
}

const iconGeometryOverflowScale = (
  icon: DiagramIconSpec | undefined,
): { widthScale: number; heightScale: number } | null => {
  if (!icon || icon.graphics.length === 0) return null
  const coordinate = iconCoordinateExtent(icon)
  const coordinateWidth = Math.max(1e-6, coordinate.maxX - coordinate.minX)
  const coordinateHeight = Math.max(1e-6, coordinate.maxY - coordinate.minY)
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  icon.graphics.forEach((graphic) => {
    if (graphic.visible === false) return
    // Text graphics can be intentionally far outside geometry and would make
    // node sizes explode; keep expansion tied to actual shape geometry.
    if (graphic.kind === 'Text') return
    const extent = graphicExtent(graphic)
    if (!extent) return
    minX = Math.min(minX, extent.minX)
    maxX = Math.max(maxX, extent.maxX)
    minY = Math.min(minY, extent.minY)
    maxY = Math.max(maxY, extent.maxY)
  })
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }
  const geometryWidth = Math.max(1e-6, maxX - minX)
  const geometryHeight = Math.max(1e-6, maxY - minY)
  return {
    widthScale: clamp(geometryWidth / coordinateWidth, 1, 2.4),
    heightScale: clamp(geometryHeight / coordinateHeight, 1, 2.4),
  }
}

const normalizeExtent = (
  extent: [[number, number], [number, number]],
): [[number, number], [number, number]] => {
  const minX = Math.min(extent[0][0], extent[1][0])
  const maxX = Math.max(extent[0][0], extent[1][0])
  const minY = Math.min(extent[0][1], extent[1][1])
  const maxY = Math.max(extent[0][1], extent[1][1])
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

const rectFromPlacement = (
  placement: DiagramPlacementTransform | undefined,
  fallbackSize: Size,
): Rect | null => {
  if (!placement) return null
  const rawExtent =
    placement.extent ??
    ([
      [-fallbackSize.width / 2, -fallbackSize.height / 2],
      [fallbackSize.width / 2, fallbackSize.height / 2],
    ] as [[number, number], [number, number]])
  const normalizedExtent = normalizeExtent(rawExtent)
  const extentCenter: [number, number] = [
    (normalizedExtent[0][0] + normalizedExtent[1][0]) / 2,
    (normalizedExtent[0][1] + normalizedExtent[1][1]) / 2,
  ]
  const hasExplicitOrigin = Array.isArray(placement.origin)
  const origin = placement.origin ?? extentCenter
  const rotation = ((placement.rotation ?? 0) * Math.PI) / 180
  const sin = Math.sin(rotation)
  const cos = Math.cos(rotation)
  const localExtent = hasExplicitOrigin
    ? normalizedExtent
    : ([
        [normalizedExtent[0][0] - extentCenter[0], normalizedExtent[0][1] - extentCenter[1]],
        [normalizedExtent[1][0] - extentCenter[0], normalizedExtent[1][1] - extentCenter[1]],
      ] as [[number, number], [number, number]])

  const localCorners: Array<[number, number]> = [
    [localExtent[0][0], localExtent[0][1]],
    [localExtent[0][0], localExtent[1][1]],
    [localExtent[1][0], localExtent[0][1]],
    [localExtent[1][0], localExtent[1][1]],
  ]

  const points = localCorners.map(([x, y]) => {
    const rx = x * cos - y * sin
    const ry = x * sin + y * cos
    return toGraphPoint({ x: origin[0] + rx, y: origin[1] + ry })
  })

  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))

  const width = Math.max(maxX - minX, fallbackSize.width)
  const height = Math.max(maxY - minY, fallbackSize.height)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }
}

const averagePoint = (points: Array<{ x: number; y: number }>): { x: number; y: number } => {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

const centerHintFromPort = (
  endpoint: { x: number; y: number },
  nextPoint: { x: number; y: number },
  size: Size,
): { x: number; y: number } => {
  const dx = endpoint.x - nextPoint.x
  const dy = endpoint.y - nextPoint.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const signX = dx === 0 ? 1 : Math.sign(dx)
    return { x: endpoint.x + signX * (size.width / 2), y: endpoint.y }
  }
  const signY = dy === 0 ? 1 : Math.sign(dy)
  return { x: endpoint.x, y: endpoint.y + signY * (size.height / 2) }
}

const buildNodeSizes = (diagram: ModelicaDiagramDto): Map<string, Size> => {
  const map = new Map<string, Size>()
  diagram.components.forEach((component) => {
    const hasIcon = Boolean(component.icon && component.icon.graphics.length > 0)
    const placementSize = sizeFromPlacementExtent(component.placement?.extent)
    const geometryScale = iconGeometryOverflowScale(component.icon)
    const fallbackText = fallbackTextSize(
      component.name,
      component.description || component.typeName,
    )
    const fallback = hasIcon
      ? {
          width: Math.max(
            (placementSize?.width ?? 60) * (geometryScale?.widthScale ?? 1),
            placementSize?.width ?? 0,
            60,
          ),
          height: Math.max(
            (placementSize?.height ?? 60) * (geometryScale?.heightScale ?? 1),
            placementSize?.height ?? 0,
            60,
          ),
        }
      : {
          width: Math.max(fallbackText.width, placementSize?.width ?? 0),
          height: Math.max(fallbackText.height, placementSize?.height ?? 0),
        }
    map.set(component.id, fallback)
  })
  return map
}

const iconCoordinateExtent = (
  icon: DiagramIconSpec | undefined,
): { minX: number; maxX: number; minY: number; maxY: number } => {
  const e = icon?.coordinateExtent ?? [
    [-100, -100],
    [100, 100],
  ]
  return {
    minX: Math.min(e[0][0], e[1][0]),
    maxX: Math.max(e[0][0], e[1][0]),
    minY: Math.min(e[0][1], e[1][1]),
    maxY: Math.max(e[0][1], e[1][1]),
  }
}

const nodePortsFromComponent = (component: {
  icon?: DiagramIconSpec
  ports?: DiagramPort[]
}): DiagramNodePortData[] => {
  const ports = component.ports ?? []
  if (ports.length === 0) return []
  const extent = iconCoordinateExtent(component.icon)
  const extentWidth = Math.max(1e-6, extent.maxX - extent.minX)
  const extentHeight = Math.max(1e-6, extent.maxY - extent.minY)
  return ports.map((port) => {
    const placement = port.placement
    const center =
      placement?.origin ??
      (placement?.extent
        ? [
            (placement.extent[0][0] + placement.extent[1][0]) / 2,
            (placement.extent[0][1] + placement.extent[1][1]) / 2,
          ]
        : [0, 0])
    const size = sizeFromPlacementExtent(placement?.extent) ?? { width: 10, height: 10 }
    const widthRatio = clamp(size.width / (extentWidth * DIAGRAM_SCALE), 0.03, 0.25)
    const heightRatio = clamp(size.height / (extentHeight * DIAGRAM_SCALE), 0.03, 0.25)
    const xRatio = clamp((center[0] - extent.minX) / extentWidth, 0, 1)
    const yRatio = clamp((extent.maxY - center[1]) / extentHeight, 0, 1)
    return {
      name: port.name,
      xRatio,
      yRatio,
      widthRatio,
      heightRatio,
      ...(port.icon ? { icon: port.icon } : {}),
    }
  })
}

const lookupPortAnchor = (
  componentId: string,
  portName: string | undefined,
  nodesById: Map<string, GraphNode<DiagramNodeData>>,
  rects: Map<string, Rect>,
): { x: number; y: number } | null => {
  if (!portName) return null
  const node = nodesById.get(componentId)
  const rect = rects.get(componentId)
  if (!node || !rect) return null
  const ports = node.data?.ports ?? []
  const match =
    ports.find((port) => port.name === portName) ??
    ports.find((port) => portName.startsWith(`${port.name}.`))
  if (!match) return null
  const center = centerOfRect(rect)
  const rawXRatio = node.data?.flipX ? 1 - match.xRatio : match.xRatio
  const rawYRatio = node.data?.flipY ? 1 - match.yRatio : match.yRatio
  const unrotated = {
    x: rect.x + rect.width * rawXRatio,
    y: rect.y + rect.height * rawYRatio,
  }
  const angle = (-(node.data?.instanceRotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = unrotated.x - center.x
  const dy = unrotated.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

const deriveFixedRects = (
  diagram: ModelicaDiagramDto,
  nodeSizes: Map<string, Size>,
): Map<string, Rect> => {
  const fixedRects = new Map<string, Rect>()
  diagram.components.forEach((component) => {
    const fallbackSize = nodeSizes.get(component.id) ?? { width: 120, height: 70 }
    const fromPlacement = rectFromPlacement(component.placement, fallbackSize)
    if (fromPlacement) fixedRects.set(component.id, fromPlacement)
  })

  const hints = new Map<string, Array<{ x: number; y: number }>>()
  diagram.connections.forEach((connection) => {
    if (!connection.linePoints || connection.linePoints.length < 2) return
    const fromPort = toGraphPoint(connection.linePoints[0]!)
    const fromNext = toGraphPoint(connection.linePoints[1]!)
    const toPort = toGraphPoint(connection.linePoints[connection.linePoints.length - 1]!)
    const toPrev = toGraphPoint(connection.linePoints[connection.linePoints.length - 2]!)
    const fromSize = nodeSizes.get(connection.from) ?? { width: 120, height: 70 }
    const toSize = nodeSizes.get(connection.to) ?? { width: 120, height: 70 }
    const fromHint = centerHintFromPort(fromPort, fromNext, fromSize)
    const toHint = centerHintFromPort(toPort, toPrev, toSize)
    if (!fixedRects.has(connection.from)) {
      const list = hints.get(connection.from) ?? []
      list.push(fromHint)
      hints.set(connection.from, list)
    }
    if (!fixedRects.has(connection.to)) {
      const list = hints.get(connection.to) ?? []
      list.push(toHint)
      hints.set(connection.to, list)
    }
  })

  hints.forEach((points, componentId) => {
    if (points.length === 0 || fixedRects.has(componentId)) return
    const size = nodeSizes.get(componentId) ?? { width: 120, height: 70 }
    const center = averagePoint(points)
    fixedRects.set(componentId, {
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
      width: size.width,
      height: size.height,
    })
  })

  return fixedRects
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((lhs, rhs) => lhs - rhs)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

const rectsOverlapWithGap = (lhs: Rect, rhs: Rect, gap: number): boolean =>
  lhs.x < rhs.x + rhs.width + gap &&
  lhs.x + lhs.width + gap > rhs.x &&
  lhs.y < rhs.y + rhs.height + gap &&
  lhs.y + lhs.height + gap > rhs.y

const distributeFixedRects = (
  diagram: ModelicaDiagramDto,
  nodeSizes: Map<string, Size>,
  authoredRects: Map<string, Rect>,
): Map<string, Rect> => {
  if (diagram.components.length === 0) return new Map()
  const sizes = diagram.components.map(
    (component) => nodeSizes.get(component.id) ?? { width: 120, height: 70 },
  )
  const gridWidth = Math.max(96, Math.round(median(sizes.map((size) => size.width)) + 32))
  const gridHeight = Math.max(80, Math.round(median(sizes.map((size) => size.height)) + 32))
  const authoredCenters = Array.from(authoredRects.values()).map(centerOfRect)
  const originX = authoredCenters.length > 0 ? Math.min(...authoredCenters.map(({ x }) => x)) : 0
  const originY = authoredCenters.length > 0 ? Math.min(...authoredCenters.map(({ y }) => y)) : 0
  const fallbackColumns = Math.max(1, Math.ceil(Math.sqrt(diagram.components.length)))
  const gap = 18

  const entries = diagram.components
    .map((component, index) => {
      const authored = authoredRects.get(component.id)
      const target = authored
        ? centerOfRect(authored)
        : {
            x: originX + (index % fallbackColumns) * gridWidth,
            y: originY + Math.floor(index / fallbackColumns) * gridHeight,
          }
      return { component, index, target }
    })
    .sort(
      (lhs, rhs) =>
        lhs.target.y - rhs.target.y ||
        lhs.target.x - rhs.target.x ||
        lhs.index - rhs.index ||
        lhs.component.id.localeCompare(rhs.component.id),
    )

  const placed: Rect[] = []
  const distributed = new Map<string, Rect>()
  const candidateCells = (baseColumn: number, baseRow: number, radius: number) => {
    if (radius === 0) return [{ column: baseColumn, row: baseRow }]
    const cells: Array<{ column: number; row: number }> = []
    for (let dx = -radius; dx <= radius; dx += 1) {
      cells.push({ column: baseColumn + dx, row: baseRow - radius })
      cells.push({ column: baseColumn + dx, row: baseRow + radius })
    }
    for (let dy = -radius + 1; dy < radius; dy += 1) {
      cells.push({ column: baseColumn - radius, row: baseRow + dy })
      cells.push({ column: baseColumn + radius, row: baseRow + dy })
    }
    return cells
  }

  entries.forEach(({ component, target }, index) => {
    const size = nodeSizes.get(component.id) ?? { width: 120, height: 70 }
    const baseColumn = Math.round((target.x - originX) / gridWidth)
    const baseRow = Math.round((target.y - originY) / gridHeight)
    let selected: Rect | null = null

    for (let radius = 0; radius <= 64 && !selected; radius += 1) {
      const cells = candidateCells(baseColumn, baseRow, radius).sort((lhs, rhs) => {
        const leftX = originX + lhs.column * gridWidth
        const leftY = originY + lhs.row * gridHeight
        const rightX = originX + rhs.column * gridWidth
        const rightY = originY + rhs.row * gridHeight
        const leftDistance = (leftX - target.x) ** 2 + (leftY - target.y) ** 2
        const rightDistance = (rightX - target.x) ** 2 + (rightY - target.y) ** 2
        return leftDistance - rightDistance || lhs.row - rhs.row || lhs.column - rhs.column
      })
      for (const cell of cells) {
        const center = {
          x: originX + cell.column * gridWidth,
          y: originY + cell.row * gridHeight,
        }
        const candidate: Rect = {
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
          width: size.width,
          height: size.height,
        }
        if (placed.every((rect) => !rectsOverlapWithGap(candidate, rect, gap))) {
          selected = candidate
          break
        }
      }
    }

    const fallback = selected ?? {
      x: originX + index * gridWidth - size.width / 2,
      y: originY + (entries.length + 1) * gridHeight - size.height / 2,
      width: size.width,
      height: size.height,
    }
    placed.push(fallback)
    distributed.set(component.id, fallback)
  })

  return distributed
}

const toFixedNodeRects = (
  fixedRects: Map<string, Rect>,
): Record<string, { x: number; y: number; width: number; height: number }> => {
  const out: Record<string, { x: number; y: number; width: number; height: number }> = {}
  fixedRects.forEach((rect, id) => {
    out[id] = rect
  })
  return out
}

export const mapDiagramToGraph = (
  diagram: ModelicaDiagramDto,
  mode: DiagramLayoutMode,
): DiagramGraphMapped => {
  const nodeSizes = buildNodeSizes(diagram)
  const fixedRects = deriveFixedRects(diagram, nodeSizes)
  const distributedRects =
    mode === 'distributed' ? distributeFixedRects(diagram, nodeSizes, fixedRects) : fixedRects
  const routedRects = mode === 'distributed' ? distributedRects : fixedRects

  const nodes: Array<GraphNode<DiagramNodeData>> = diagram.components.map((component) => {
    const hasIcon = Boolean(component.icon && component.icon.graphics.length > 0)
    const preferredSize = nodeSizes.get(component.id) ?? { width: 120, height: 70 }
    const data: DiagramNodeData = {
      typeName: component.typeName,
      description: component.description || component.typeName,
      iconValues: component.iconValues ?? {},
      hasIcon,
      preferredWidth: preferredSize.width,
      preferredHeight: preferredSize.height,
      instanceRotation: component.placement?.rotation ?? 0,
      flipX:
        (component.placement?.extent?.[1][0] ?? 1) - (component.placement?.extent?.[0][0] ?? -1) <
        0,
      flipY:
        (component.placement?.extent?.[1][1] ?? 1) - (component.placement?.extent?.[0][1] ?? -1) <
        0,
      ports: nodePortsFromComponent(component),
    }
    if (component.qualifiedTypeName) data.qualifiedTypeName = component.qualifiedTypeName
    if (component.iconRef) data.iconRef = component.iconRef
    if (component.icon) data.icon = component.icon
    return {
      id: component.id,
      label: component.name,
      type: 'modelica-component',
      data,
    }
  })
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const))

  const edges: GraphData<DiagramNodeData, DiagramEdgeData>['edges'] = diagram.connections.map(
    (connection) => {
      const explicitPoints = connection.linePoints?.map((point) => toGraphPoint(point))
      const fromRect = routedRects.get(connection.from)
      const toRect = routedRects.get(connection.to)
      const fromPortAnchor = lookupPortAnchor(
        connection.from,
        connection.fromPort,
        nodesById,
        routedRects,
      )
      const toPortAnchor = lookupPortAnchor(
        connection.to,
        connection.toPort,
        nodesById,
        routedRects,
      )
      const generatedPoints =
        fromRect && toRect
          ? [fromPortAnchor ?? centerOfRect(fromRect), toPortAnchor ?? centerOfRect(toRect)]
          : undefined
      const data: DiagramEdgeData = {}
      if (explicitPoints && mode === 'authored') {
        const anchoredPoints = [...explicitPoints]
        if (fromPortAnchor && anchoredPoints.length > 0) anchoredPoints[0] = fromPortAnchor
        if (toPortAnchor && anchoredPoints.length > 0)
          anchoredPoints[anchoredPoints.length - 1] = toPortAnchor
        data.linePoints = anchoredPoints
        data.preferredPoints = anchoredPoints
        data.lockPreferredPath = true
        data.preservePreferredEndpoints = false
      } else if (mode === 'distributed' && generatedPoints) {
        data.preferredPoints = generatedPoints
        data.preservePreferredEndpoints = true
      } else if (!explicitPoints && generatedPoints && mode !== 'auto') {
        data.preferredPoints = generatedPoints
      }
      if (connection.lineColor) data.color = connection.lineColor
      if (connection.fromPort) data.fromPort = connection.fromPort
      if (connection.toPort) data.toPort = connection.toPort
      return {
        id: connection.id,
        source: connection.from,
        target: connection.to,
        type: 'modelica-connect',
        data,
      }
    },
  )

  const optionsBase: RenderOptions<DiagramNodeData, DiagramEdgeData> = {
    direction: mode === 'auto' ? 'LR' : 'TB',
    adaptNodeToContent: false,
    routeOnGrid: true,
    nodeWidth: (node) => (node.data as DiagramNodeData | undefined)?.preferredWidth ?? 220,
    nodeHeight: (node) => (node.data as DiagramNodeData | undefined)?.preferredHeight ?? 84,
    theme: {
      defaultNodeStyle: {
        fill: 'rgba(229, 231, 235, 0.94)',
        stroke: 'rgba(55, 65, 81, 0.9)',
        strokeWidth: 1.1,
        rx: 6,
        ry: 6,
        textColor: 'rgba(17, 24, 39, 0.95)',
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontWeight: 600,
      },
      defaultEdgeStyle: {
        stroke: 'rgba(37, 99, 235, 0.95)',
        strokeWidth: 1.4,
      },
    },
  }

  const layoutRects = mode === 'distributed' ? distributedRects : fixedRects
  const fixedNodeRects = toFixedNodeRects(layoutRects)
  const options: RenderOptions<DiagramNodeData, DiagramEdgeData> =
    mode !== 'auto' && Object.keys(fixedNodeRects).length > 0
      ? { ...optionsBase, fixedNodeRects }
      : optionsBase

  return {
    graph: { nodes, edges },
    options,
  }
}
