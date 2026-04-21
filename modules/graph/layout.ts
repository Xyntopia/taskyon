import { adjacencyFromEdges, byId, clamp, computeInDegree, normalizeGraph, toArray } from './graphUtils'
import { roundedPolylinePath } from './pathUtils'
import type {
  GraphData,
  GraphNode,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
} from './types'

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Segment = { a: Point; b: Point }

type ObjectiveWeights = {
  crossings: number
  span: number
  corners: number
  space: number
  edgeLength: number
  edgeLengthVariance: number
  nodeOverlap: number
  edgeNodeOverlap: number
  edgeEdgeOverlap: number
  angularResolution: number
  nodeDistance: number
  symmetry: number
  stability: number
  hierarchyAlignment: number
  labelReadability: number
  portConsistency: number
  bendVariance: number
  pathMonotonicity: number
}

const DEFAULT_OBJECTIVE_WEIGHTS: ObjectiveWeights = {
  crossings: 1,
  span: 0.15,
  corners: 0.5,
  space: 0.12,
  edgeLength: 0.1,
  edgeLengthVariance: 0.08,
  nodeOverlap: 2.2,
  edgeNodeOverlap: 2.4,
  edgeEdgeOverlap: 1.2,
  angularResolution: 0.35,
  nodeDistance: 0.16,
  symmetry: 0.08,
  stability: 0.15,
  hierarchyAlignment: 0.4,
  labelReadability: 0.25,
  portConsistency: 0.12,
  bendVariance: 0.12,
  pathMonotonicity: 0.45,
}

const resolveObjectiveWeights = (opts: LayoutOptions): ObjectiveWeights => ({
  ...DEFAULT_OBJECTIVE_WEIGHTS,
  ...(opts.objectiveWeights ?? {}),
})

const resolveSize = (
  node: GraphNode,
  value: number | ((node: GraphNode) => number) | undefined,
  fallback: number,
): number => (typeof value === 'function' ? value(node) : value ?? fallback)

const estimateContentNodeSize = (
  node: GraphNode,
  opts: LayoutOptions,
): { width: number; height: number } => {
  const fontSize = opts.contentFontSize ?? 14
  const text = (node.label ?? node.id ?? '').trim()
  const lines = text.length > 0 ? text.split(/\n+/) : ['']
  const maxChars = Math.max(...lines.map((l) => l.length), 1)
  const paddingX = 24
  const paddingY = 18
  const lineHeight = Math.round(fontSize * 1.35)
  const width = Math.max(120, Math.min(520, Math.round(maxChars * (fontSize * 0.62) + paddingX)))
  const height = Math.max(
    56,
    Math.min(260, Math.round(lines.length * lineHeight + paddingY)),
  )
  return { width, height }
}

const pointDistance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

const polylineLength = (points: Point[]): number => {
  let length = 0
  for (let i = 0; i < points.length - 1; i += 1) length += pointDistance(points[i]!, points[i + 1]!)
  return length
}

const segmentsFromPolyline = (points: Point[]): Segment[] => {
  const segments: Segment[] = []
  for (let i = 0; i < points.length - 1; i += 1) segments.push({ a: points[i]!, b: points[i + 1]! })
  return segments
}

const rangesOverlap = (a1: number, a2: number, b1: number, b2: number): boolean => {
  const minA = Math.min(a1, a2)
  const maxA = Math.max(a1, a2)
  const minB = Math.min(b1, b2)
  const maxB = Math.max(b1, b2)
  return maxA >= minB && maxB >= minA
}

const orientation = (a: Point, b: Point, c: Point): number => {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(val) < 0.0001) return 0
  return val > 0 ? 1 : 2
}

const onSegment = (a: Point, b: Point, c: Point): boolean =>
  b.x <= Math.max(a.x, c.x) + 0.0001 &&
  b.x + 0.0001 >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) + 0.0001 &&
  b.y + 0.0001 >= Math.min(a.y, c.y)

const segmentsIntersect = (s1: Segment, s2: Segment): boolean => {
  const o1 = orientation(s1.a, s1.b, s2.a)
  const o2 = orientation(s1.a, s1.b, s2.b)
  const o3 = orientation(s2.a, s2.b, s1.a)
  const o4 = orientation(s2.a, s2.b, s1.b)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(s1.a, s2.a, s1.b)) return true
  if (o2 === 0 && onSegment(s1.a, s2.b, s1.b)) return true
  if (o3 === 0 && onSegment(s2.a, s1.a, s2.b)) return true
  if (o4 === 0 && onSegment(s2.a, s1.b, s2.b)) return true
  return false
}

const pointInRect = (p: Point, rect: Rect): boolean =>
  p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height

const segmentMidpoint = (segment: Segment): Point => ({
  x: (segment.a.x + segment.b.x) / 2,
  y: (segment.a.y + segment.b.y) / 2,
})

const edgeDirectionAngle = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x)

const smallestAngleDifference = (a: number, b: number): number => {
  const diff = Math.abs(a - b) % (Math.PI * 2)
  return diff > Math.PI ? Math.PI * 2 - diff : diff
}

const topologicalOrder = (nodes: GraphNode[], edges: Array<{ source: string; target: string }>) => {
  const indegree = computeInDegree(nodes, edges)
  const adjacency = adjacencyFromEdges(edges)
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const order: string[] = []

  while (queue.length > 0) {
    const cur = queue.shift()!
    order.push(cur)
    const targets = adjacency.get(cur) ?? []
    for (const target of targets) {
      const nextDeg = (indegree.get(target) ?? 0) - 1
      indegree.set(target, nextDeg)
      if (nextDeg === 0) queue.push(target)
    }
  }

  if (order.length === nodes.length) return order
  return nodes.map((n) => n.id)
}

const assignLayers = (nodes: GraphNode[], edges: Array<{ source: string; target: string }>) => {
  const order = topologicalOrder(nodes, edges)
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const arr = incoming.get(edge.target) ?? []
    arr.push(edge.source)
    incoming.set(edge.target, arr)
  }

  const layerByNode = new Map<string, number>()
  for (const id of order) {
    const preds = incoming.get(id) ?? []
    const layer = preds.length
      ? Math.max(...preds.map((p) => layerByNode.get(p) ?? 0)) + 1
      : 0
    layerByNode.set(id, layer)
  }
  return layerByNode
}

const orderWithinLayers = (
  layerNodes: Map<number, string[]>,
  edges: Array<{ source: string; target: string }>,
  opts: LayoutOptions,
) => {
  const layerById = new Map<string, number>()
  for (const [layer, ids] of layerNodes.entries()) {
    ids.forEach((id) => layerById.set(id, layer))
  }

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const arr = incoming.get(edge.target) ?? []
    arr.push(edge.source)
    incoming.set(edge.target, arr)
    const out = outgoing.get(edge.source) ?? []
    out.push(edge.target)
    outgoing.set(edge.source, out)
  }

  const position = new Map<string, number>()
  for (const ids of layerNodes.values()) ids.forEach((id, idx) => position.set(id, idx))

  const objectiveWeights = resolveObjectiveWeights(opts)

  const layerCrossings = (a: number, b: number): number => {
    const crossingEdges = edges.filter((e) => {
      const ls = layerById.get(e.source)
      const lt = layerById.get(e.target)
      return ls === a && lt === b
    })
    let crossings = 0
    for (let i = 0; i < crossingEdges.length; i += 1) {
      for (let j = i + 1; j < crossingEdges.length; j += 1) {
        const e1 = crossingEdges[i]!
        const e2 = crossingEdges[j]!
        const s1 = position.get(e1.source) ?? 0
        const s2 = position.get(e2.source) ?? 0
        const t1 = position.get(e1.target) ?? 0
        const t2 = position.get(e2.target) ?? 0
        if ((s1 - s2) * (t1 - t2) < 0) crossings += 1
      }
    }
    return crossings
  }

  const totalCrossings = (layers: number[]): number => {
    let total = 0
    for (let i = 0; i < layers.length - 1; i += 1) {
      total += layerCrossings(layers[i]!, layers[i + 1]!)
    }
    return total
  }

  const edgeSpanPenalty = (): number => {
    let penalty = 0
    for (const edge of edges) {
      const s = position.get(edge.source)
      const t = position.get(edge.target)
      if (s === undefined || t === undefined) continue
      penalty += Math.abs(s - t)
    }
    return penalty
  }

  const hierarchyAlignmentPenalty = (): number => {
    let penalty = 0
    for (const edge of edges) {
      const sourceLayer = layerById.get(edge.source) ?? 0
      const targetLayer = layerById.get(edge.target) ?? 0
      if (targetLayer < sourceLayer) penalty += sourceLayer - targetLayer
      else if (targetLayer === sourceLayer) penalty += 0.5
    }
    return penalty
  }

  const symmetryPenalty = (): number => {
    let penalty = 0
    for (const layer of layers) {
      const ids = layerNodes.get(layer) ?? []
      const center = (ids.length - 1) / 2
      for (let i = 0; i < ids.length; i += 1) penalty += Math.abs(i - center)
    }
    return penalty
  }

  const stabilityPenalty = (): number => {
    const prev = opts.previousNodePositions
    if (!prev) return 0
    let penalty = 0
    for (const [layer, ids] of layerNodes.entries()) {
      const prevOrdered = ids
        .filter((id) => prev[id] !== undefined)
        .sort((a, b) => {
          const pa = prev[a]!
          const pb = prev[b]!
          const av = (opts.direction ?? 'TB') === 'TB' ? pa.x : pa.y
          const bv = (opts.direction ?? 'TB') === 'TB' ? pb.x : pb.y
          return av - bv
        })
      if (prevOrdered.length < 2) {
        void layer
        continue
      }
      const prevRank = new Map<string, number>(prevOrdered.map((id, i) => [id, i]))
      ids.forEach((id, currentIndex) => {
        const rank = prevRank.get(id)
        if (rank === undefined) return
        penalty += Math.abs(currentIndex - rank)
      })
    }
    return penalty
  }

  const totalObjective = (layers: number[]): number =>
    totalCrossings(layers) * objectiveWeights.crossings +
    edgeSpanPenalty() * objectiveWeights.span +
    hierarchyAlignmentPenalty() * objectiveWeights.hierarchyAlignment +
    symmetryPenalty() * objectiveWeights.symmetry +
    stabilityPenalty() * objectiveWeights.stability

  const barycenterSort = (layer: number, mode: 'incoming' | 'outgoing') => {
    const ids = [...(layerNodes.get(layer) ?? [])]
    ids.sort((a, b) => {
      const refsA = mode === 'incoming' ? incoming.get(a) ?? [] : outgoing.get(a) ?? []
      const refsB = mode === 'incoming' ? incoming.get(b) ?? [] : outgoing.get(b) ?? []
      const avgA =
        refsA.length > 0
          ? refsA.reduce((acc, id) => acc + (position.get(id) ?? 0), 0) / refsA.length
          : position.get(a) ?? 0
      const avgB =
        refsB.length > 0
          ? refsB.reduce((acc, id) => acc + (position.get(id) ?? 0), 0) / refsB.length
          : position.get(b) ?? 0
      return avgA - avgB
    })
    layerNodes.set(layer, ids)
    ids.forEach((id, idx) => position.set(id, idx))
  }

  const transposeLayer = (layer: number, layers: number[], maxPasses: number) => {
    let pass = 0
    while (pass < maxPasses) {
      pass += 1
      let improved = false
      const ids = layerNodes.get(layer)
      if (!ids || ids.length < 2) break
      for (let i = 0; i < ids.length - 1; i += 1) {
        const a = ids[i]!
        const b = ids[i + 1]!
        const before = totalObjective(layers)
        ids[i] = b
        ids[i + 1] = a
        position.set(a, i + 1)
        position.set(b, i)
        const after = totalObjective(layers)
        if (after < before) {
          improved = true
          continue
        }
        ids[i] = a
        ids[i + 1] = b
        position.set(a, i)
        position.set(b, i + 1)
      }
      if (!improved) break
    }
  }

  const layers = toArray(layerNodes.keys()).sort((a, b) => a - b)
  const sweepPasses = opts.crossingMinimizationPasses ?? 8
  const transposePasses = opts.transposePasses ?? 2

  for (let pass = 0; pass < sweepPasses; pass += 1) {
    for (let i = 1; i < layers.length; i += 1) barycenterSort(layers[i]!, 'incoming')
    for (let i = layers.length - 2; i >= 0; i -= 1) barycenterSort(layers[i]!, 'outgoing')
    for (const layer of layers) transposeLayer(layer, layers, transposePasses)
  }
}

const layoutNodes = <N = unknown, E = unknown>(
  graph: GraphData<N, E>,
  opts: LayoutOptions,
): LayoutNode<N>[] => {
  const direction = opts.direction ?? 'TB'
  const objectiveWeights = resolveObjectiveWeights(opts)
  const compactFactor = 1 - clamp(objectiveWeights.space * 0.12, 0, 0.45)
  const separationFactor = 1 + clamp(objectiveWeights.nodeDistance * 0.06, 0, 0.35)
  const overlapFactor = 1 + clamp(objectiveWeights.nodeOverlap * 0.04, 0, 0.35)
  const layerGap = Math.round((opts.layerGap ?? 120) * compactFactor * separationFactor)
  const nodeGap = Math.round((opts.nodeGap ?? 36) * compactFactor * separationFactor * overlapFactor)
  const margin = opts.margin ?? 24
  const nodeSize = graph.nodes.map((n) => {
    const contentSize = estimateContentNodeSize(n, opts)
    const width = opts.adaptNodeToContent
      ? contentSize.width
      : resolveSize(n, opts.nodeWidth, 220)
    const height = opts.adaptNodeToContent
      ? contentSize.height
      : resolveSize(n, opts.nodeHeight, 84)
    return {
      id: n.id,
      type: n.type ?? '__default__',
      width,
      height,
    }
  })

  if (opts.uniformNodeSizeByType) {
    const maxByType = new Map<string, { width: number; height: number }>()
    for (const s of nodeSize) {
      const prev = maxByType.get(s.type)
      if (!prev) {
        maxByType.set(s.type, { width: s.width, height: s.height })
        continue
      }
      maxByType.set(s.type, {
        width: Math.max(prev.width, s.width),
        height: Math.max(prev.height, s.height),
      })
    }
    for (const s of nodeSize) {
      const max = maxByType.get(s.type)
      if (!max) continue
      s.width = max.width
      s.height = max.height
    }
  }

  const sizeById = byId(nodeSize)

  const layerByNode = assignLayers(graph.nodes, graph.edges)
  const layerNodes = new Map<number, string[]>()
  for (const node of graph.nodes) {
    const layer = layerByNode.get(node.id) ?? 0
    const ids = layerNodes.get(layer) ?? []
    ids.push(node.id)
    layerNodes.set(layer, ids)
  }
  if (opts.optimizeLayout !== false) orderWithinLayers(layerNodes, graph.edges, opts)

  const laidOut: LayoutNode<N>[] = []
  const layers = toArray(layerNodes.keys()).sort((a, b) => a - b)
  const layerPrimaryOffset = new Map<number, number>()
  let running = margin

  for (const layer of layers) {
    layerPrimaryOffset.set(layer, running)
    const ids = layerNodes.get(layer) ?? []
    const maxPrimary = Math.max(
      0,
      ...ids.map((id) => {
        const s = sizeById.get(id)
        return direction === 'TB' ? (s?.height ?? 84) : (s?.width ?? 220)
      }),
    )
    running += maxPrimary + layerGap
  }

  for (const layer of layers) {
    const ids = layerNodes.get(layer) ?? []
    let secondary = margin
    ids.forEach((id, index) => {
      const node = graph.nodes.find((n) => n.id === id)!
      const size = sizeById.get(id)!
      const x = direction === 'TB' ? secondary : layerPrimaryOffset.get(layer)!
      const y = direction === 'TB' ? layerPrimaryOffset.get(layer)! : secondary
      laidOut.push({
        ...node,
        x,
        y,
        width: size.width,
        height: size.height,
        layer,
        order: index,
      })
      secondary += (direction === 'TB' ? size.width : size.height) + nodeGap
    })
  }

  return laidOut
}

const edgeAnchorPoints = <E = unknown>(
  edge: { source: string; target: string } & E,
  nodesById: Map<string, LayoutNode>,
  direction: 'TB' | 'LR',
): { start: Point; end: Point; sourceLayer: number; targetLayer: number } => {
  const source = nodesById.get(edge.source)!
  const target = nodesById.get(edge.target)!
  if (direction === 'TB') {
    return {
      start: { x: source.x + source.width / 2, y: source.y + source.height },
      end: { x: target.x + target.width / 2, y: target.y },
      sourceLayer: source.layer,
      targetLayer: target.layer,
    }
  }
  return {
    start: { x: source.x + source.width, y: source.y + source.height / 2 },
    end: { x: target.x, y: target.y + target.height / 2 },
    sourceLayer: source.layer,
    targetLayer: target.layer,
  }
}

const expandRect = (rect: Rect, padding: number): Rect => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
})

const lineIntersectsRectAxisAligned = (a: Point, b: Point, rect: Rect): boolean => {
  const x1 = rect.x
  const x2 = rect.x + rect.width
  const y1 = rect.y
  const y2 = rect.y + rect.height

  if (Math.abs(a.x - b.x) < 0.0001) {
    const x = a.x
    if (x < x1 || x > x2) return false
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    return maxY >= y1 && minY <= y2
  }
  if (Math.abs(a.y - b.y) < 0.0001) {
    const y = a.y
    if (y < y1 || y > y2) return false
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    return maxX >= x1 && minX <= x2
  }
  return false
}

const polylineHitsAnyRect = (points: Point[], rects: Rect[]): boolean => {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (rects.some((rect) => lineIntersectsRectAxisAligned(a, b, rect))) return true
  }
  return false
}

const snapToGrid = (value: number, size: number, offset: number): number => {
  if (!Number.isFinite(size) || size <= 0) return value
  return Math.round((value - offset) / size) * size + offset
}

const routeEdgeCandidates = (
  start: Point,
  end: Point,
  direction: 'TB' | 'LR',
  laneOffset: number,
  obstacles: Rect[],
  splitBias: number,
  grid: { enabled: boolean; size: number; xOffset: number; yOffset: number },
): Point[][] => {
  const clampedSplitBias = clamp(splitBias, 0.2, 0.9)
  const sx = (v: number): number => (grid.enabled ? snapToGrid(v, grid.size, grid.xOffset) : v)
  const sy = (v: number): number => (grid.enabled ? snapToGrid(v, grid.size, grid.yOffset) : v)
  if (direction === 'LR') {
    const midX = sx((start.x + end.x) / 2 + laneOffset)
    const lateSplitX = sx(start.x + (end.x - start.x) * clampedSplitBias + laneOffset * 0.15)
    const straight = Math.abs(start.y - end.y) < 0.0001 ? [start, end] : null
    const elbow = [start, { x: end.x, y: start.y }, end]
    const simple = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
    const lateSplit = [start, { x: lateSplitX, y: start.y }, { x: lateSplitX, y: end.y }, end]
    const laneBias = laneOffset * 0.35
    const corridorMinX = Math.min(start.x, end.x) - 32
    const corridorMaxX = Math.max(start.x, end.x) + 32
    const corridorObstacles = obstacles.filter(
      (r) => r.x <= corridorMaxX && r.x + r.width >= corridorMinX,
    )
    const topTrack =
      Math.min(start.y, end.y, ...(corridorObstacles.length > 0 ? corridorObstacles.map((r) => r.y) : [])) -
      28 -
      laneBias
    const bottomTrack =
      Math.max(
        start.y,
        end.y,
        ...(corridorObstacles.length > 0 ? corridorObstacles.map((r) => r.y + r.height) : []),
      ) +
      28 +
      laneBias
    const bendInX = sx(start.x + 24)
    const bendOutX = sx(end.x - 24)
    const topTrackSnapped = sy(topTrack)
    const bottomTrackSnapped = sy(bottomTrack)
    const topPath = [
      start,
      { x: bendInX, y: start.y },
      { x: bendInX, y: topTrackSnapped },
      { x: bendOutX, y: topTrackSnapped },
      { x: bendOutX, y: end.y },
      end,
    ]
    const bottomPath = [
      start,
      { x: bendInX, y: start.y },
      { x: bendInX, y: bottomTrackSnapped },
      { x: bendOutX, y: bottomTrackSnapped },
      { x: bendOutX, y: end.y },
      end,
    ]
    return [straight, elbow, simple, lateSplit, topPath, bottomPath].filter((p): p is Point[] => p !== null)
  }

  const midY = sy((start.y + end.y) / 2 + laneOffset)
  const lateSplitY = sy(start.y + (end.y - start.y) * clampedSplitBias + laneOffset * 0.15)
  const straight = Math.abs(start.x - end.x) < 0.0001 ? [start, end] : null
  const elbow = [start, { x: start.x, y: end.y }, end]
  const simple = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
  const lateSplit = [start, { x: start.x, y: lateSplitY }, { x: end.x, y: lateSplitY }, end]
  const laneBias = laneOffset * 0.35
  const corridorMinY = Math.min(start.y, end.y) - 32
  const corridorMaxY = Math.max(start.y, end.y) + 32
  const corridorObstacles = obstacles.filter(
    (r) => r.y <= corridorMaxY && r.y + r.height >= corridorMinY,
  )
  const leftTrack =
    Math.min(start.x, end.x, ...(corridorObstacles.length > 0 ? corridorObstacles.map((r) => r.x) : [])) -
    28 -
    laneBias
  const rightTrack =
    Math.max(
      start.x,
      end.x,
      ...(corridorObstacles.length > 0 ? corridorObstacles.map((r) => r.x + r.width) : []),
    ) +
    28 +
    laneBias
  const bendInY = sy(start.y + 24)
  const bendOutY = sy(end.y - 24)
  const leftTrackSnapped = sx(leftTrack)
  const rightTrackSnapped = sx(rightTrack)
  const leftPath = [
    start,
    { x: start.x, y: bendInY },
    { x: leftTrackSnapped, y: bendInY },
    { x: leftTrackSnapped, y: bendOutY },
    { x: end.x, y: bendOutY },
    end,
  ]
  const rightPath = [
    start,
    { x: start.x, y: bendInY },
    { x: rightTrackSnapped, y: bendInY },
    { x: rightTrackSnapped, y: bendOutY },
    { x: end.x, y: bendOutY },
    end,
  ]
  return [straight, elbow, simple, lateSplit, leftPath, rightPath].filter((p): p is Point[] => p !== null)
}

const emergencyDetourCandidates = (
  start: Point,
  end: Point,
  direction: 'TB' | 'LR',
  obstacles: Rect[],
  grid: { enabled: boolean; size: number; xOffset: number; yOffset: number },
): Point[][] => {
  const sx = (v: number): number => (grid.enabled ? snapToGrid(v, grid.size, grid.xOffset) : v)
  const sy = (v: number): number => (grid.enabled ? snapToGrid(v, grid.size, grid.yOffset) : v)
  if (direction === 'LR') {
    const topTrack =
      Math.min(start.y, end.y, ...(obstacles.length > 0 ? obstacles.map((r) => r.y) : [])) - 42
    const bottomTrack =
      Math.max(start.y, end.y, ...(obstacles.length > 0 ? obstacles.map((r) => r.y + r.height) : [])) + 42
    const inX = sx(start.x + 18)
    const outX = sx(end.x - 18)
    const topTrackSnapped = sy(topTrack)
    const bottomTrackSnapped = sy(bottomTrack)
    return [
      [
        start,
        { x: inX, y: start.y },
        { x: inX, y: topTrackSnapped },
        { x: outX, y: topTrackSnapped },
        { x: outX, y: end.y },
        end,
      ],
      [
        start,
        { x: inX, y: start.y },
        { x: inX, y: bottomTrackSnapped },
        { x: outX, y: bottomTrackSnapped },
        { x: outX, y: end.y },
        end,
      ],
    ]
  }

  const leftTrack =
    Math.min(start.x, end.x, ...(obstacles.length > 0 ? obstacles.map((r) => r.x) : [])) - 42
  const rightTrack =
    Math.max(start.x, end.x, ...(obstacles.length > 0 ? obstacles.map((r) => r.x + r.width) : [])) + 42
  const inY = sy(start.y + 18)
  const outY = sy(end.y - 18)
  const leftTrackSnapped = sx(leftTrack)
  const rightTrackSnapped = sx(rightTrack)
  return [
    [start, { x: start.x, y: inY }, { x: leftTrackSnapped, y: inY }, { x: leftTrackSnapped, y: outY }, { x: end.x, y: outY }, end],
    [
      start,
      { x: start.x, y: inY },
      { x: rightTrackSnapped, y: inY },
      { x: rightTrackSnapped, y: outY },
      { x: end.x, y: outY },
      end,
    ],
  ]
}

const polylineBoundingArea = (points: Point[]): number => {
  if (points.length === 0) return 0
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
}

const pathMonotonicityPenalty = (points: Point[], direction: 'TB' | 'LR'): number => {
  let penalty = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const delta = direction === 'TB' ? b.y - a.y : b.x - a.x
    if (delta < 0) penalty += Math.abs(delta)
  }
  return penalty
}

const orthogonalGeometryPenalty = (points: Point[]): number => {
  if (points.length < 3) return 0
  let penalty = 0
  const epsilon = 0.0001
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const c = points[i + 1]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const bcx = c.x - b.x
    const bcy = c.y - b.y
    const abLen = Math.hypot(abx, aby)
    const bcLen = Math.hypot(bcx, bcy)
    if (abLen < 8 || bcLen < 8) penalty += 0.9
    const collinearX = Math.abs(a.x - b.x) < epsilon && Math.abs(b.x - c.x) < epsilon
    const collinearY = Math.abs(a.y - b.y) < epsilon && Math.abs(b.y - c.y) < epsilon
    if (collinearX || collinearY) penalty += 2.5
    const horizontalReverse = Math.abs(aby) < epsilon && Math.abs(bcy) < epsilon && abx * bcx < 0
    const verticalReverse = Math.abs(abx) < epsilon && Math.abs(bcx) < epsilon && aby * bcy < 0
    if (horizontalReverse || verticalReverse) penalty += 3.2
  }
  return penalty
}

const portConsistencyPenalty = (
  points: Point[],
  direction: 'TB' | 'LR',
  start: Point,
  end: Point,
  preferredLaneOffset: number,
): number => {
  const preferred = direction === 'TB'
    ? (start.y + end.y) / 2 + preferredLaneOffset
    : (start.x + end.x) / 2 + preferredLaneOffset
  let closest = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    if (direction === 'TB') {
      if (Math.abs(a.y - b.y) > 0.0001) continue
      const dist = Math.abs(a.y - preferred)
      if (dist < closest) closest = dist
      continue
    }
    if (Math.abs(a.x - b.x) > 0.0001) continue
    const dist = Math.abs(a.x - preferred)
    if (dist < closest) closest = dist
  }
  if (!Number.isFinite(closest)) return Math.abs(preferredLaneOffset) * 1.5
  return closest
}

const earlyFanoutPenalty = (
  points: Point[],
  direction: 'TB' | 'LR',
): number => {
  if (points.length < 2) return 0
  const start = points[0]!
  const end = points[points.length - 1]!
  const epsilon = 0.0001

  const primaryDistance = direction === 'TB'
    ? Math.abs(end.y - start.y)
    : Math.abs(end.x - start.x)
  if (primaryDistance <= epsilon) return 0

  let splitDistance = primaryDistance
  if (direction === 'TB') {
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i]!.x - start.x) <= epsilon) continue
      splitDistance = Math.abs(points[i - 1]!.y - start.y)
      break
    }
  } else {
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i]!.y - start.y) <= epsilon) continue
      splitDistance = Math.abs(points[i - 1]!.x - start.x)
      break
    }
  }

  const keptTogetherRatio = clamp(splitDistance / primaryDistance, 0, 1)
  return 1 - keptTogetherRatio
}

export const routeLayoutEdges = <N = unknown, E = unknown>(
  nodes: LayoutNode<N>[],
  edges: Array<{
    id: string
    source: string
    target: string
    type?: string
    label?: string
    data?: E
  }>,
  opts: LayoutOptions,
): LayoutEdge<E>[] => {
  const direction = opts.direction ?? 'TB'
  const radius = opts.cornerRadius ?? 8
  const objectiveWeights = resolveObjectiveWeights(opts)
  const nodesById = byId(nodes)
  const edgeTypeOrder = new Map<string, number>()
  const sourceAngles = new Map<string, number[]>()
  const targetAngles = new Map<string, number[]>()
  const routedSegments: Array<{ segment: Segment; type: string }> = []
  const routedHeadSegments: Array<{ source: string; type: string; segment: Segment }> = []
  const routedLengths: number[] = []
  const routedBends: number[] = []
  const edgeLabelSize = opts.edgeLabelSize ?? { width: 80, height: 20 }
  const sortedTypes = Array.from(
    new Set(edges.map((e) => e.type ?? '__default__').filter((x) => typeof x === 'string')),
  ).sort()
  sortedTypes.forEach((t, idx) => edgeTypeOrder.set(t, idx))
  const typeCenter = (sortedTypes.length - 1) / 2
  const globalTypeLaneSeparation = 16
  const sourceTypeLaneSeparation = 9
  const sourceWithinTypeLaneSeparation = 0.35
  const routeOnGrid = opts.routeOnGrid ?? true
  const routingGridSize = Math.max(4, opts.routingGridSize ?? 12)
  const routingGridTypeOffset = opts.routingGridTypeOffset ?? 5.5
  const outgoingCountBySource = new Map<string, number>()
  for (const edge of edges) {
    outgoingCountBySource.set(edge.source, (outgoingCountBySource.get(edge.source) ?? 0) + 1)
  }
  const laneOffsetByEdgeId = new Map<string, number>()
  const outgoingBySource = new Map<string, Array<{ id: string; type: string }>>()
  for (const edge of edges) {
    const list = outgoingBySource.get(edge.source) ?? []
    list.push({ id: edge.id, type: edge.type ?? '__default__' })
    outgoingBySource.set(edge.source, list)
  }
  for (const [source, list] of outgoingBySource.entries()) {
    const byType = new Map<string, string[]>()
    for (const item of list) {
      const arr = byType.get(item.type) ?? []
      arr.push(item.id)
      byType.set(item.type, arr)
    }
    const sourceTypes = Array.from(byType.keys()).sort((a, b) => {
      const aa = edgeTypeOrder.get(a) ?? 0
      const bb = edgeTypeOrder.get(b) ?? 0
      if (aa !== bb) return aa - bb
      return a.localeCompare(b)
    })
    const sourceTypeCenter = (sourceTypes.length - 1) / 2
    for (let typeIdx = 0; typeIdx < sourceTypes.length; typeIdx += 1) {
      const type = sourceTypes[typeIdx]!
      const ids = byType.get(type) ?? []
      const idsCenter = (ids.length - 1) / 2
      for (let edgeIdx = 0; edgeIdx < ids.length; edgeIdx += 1) {
        const edgeId = ids[edgeIdx]!
        const typeDelta = (edgeTypeOrder.get(type) ?? 0) - typeCenter
        const globalTypeOffset = typeDelta * globalTypeLaneSeparation
        const sourceTypeOffset = (typeIdx - sourceTypeCenter) * sourceTypeLaneSeparation
        const withinTypeOffset = (edgeIdx - idsCenter) * sourceWithinTypeLaneSeparation
        laneOffsetByEdgeId.set(edgeId, globalTypeOffset + sourceTypeOffset + withinTypeOffset)
      }
    }
    void source
  }

  const sharedTrunkScore = (
    points: Point[],
    edge: { source: string; type?: string },
  ): { bonus: number; differentTypeTooClosePenalty: number } => {
    if (points.length < 2) return { bonus: 0, differentTypeTooClosePenalty: 0 }
    const first = { a: points[0]!, b: points[1]! }
    let bonus = 0
    let differentTypeTooClosePenalty = 0
    const sameDirThreshold = 0.0001
    const edgeType = edge.type ?? '__default__'
    const desiredDifferentTypeGap = 8
    for (const prior of routedHeadSegments) {
      if (prior.source !== edge.source) continue
      const p = prior.segment
      if (direction === 'TB') {
        const firstVertical = Math.abs(first.a.x - first.b.x) < sameDirThreshold
        const priorVertical = Math.abs(p.a.x - p.b.x) < sameDirThreshold
        if (!firstVertical || !priorVertical) continue
        const gap = Math.abs(first.a.x - p.a.x)
        if (prior.type === edgeType) {
          bonus += Math.max(0, 1 - gap / 10) * 3.6
        } else {
          bonus += Math.max(0, 1 - gap / 28) * 0.45
          if (gap < desiredDifferentTypeGap) {
            differentTypeTooClosePenalty += 1 - gap / desiredDifferentTypeGap
          }
        }
      } else {
        const firstHorizontal = Math.abs(first.a.y - first.b.y) < sameDirThreshold
        const priorHorizontal = Math.abs(p.a.y - p.b.y) < sameDirThreshold
        if (!firstHorizontal || !priorHorizontal) continue
        const gap = Math.abs(first.a.y - p.a.y)
        if (prior.type === edgeType) {
          bonus += Math.max(0, 1 - gap / 10) * 3.6
        } else {
          bonus += Math.max(0, 1 - gap / 28) * 0.45
          if (gap < desiredDifferentTypeGap) {
            differentTypeTooClosePenalty += 1 - gap / desiredDifferentTypeGap
          }
        }
      }
    }
    return { bonus, differentTypeTooClosePenalty }
  }

  const scoreCandidate = (
    points: Point[],
    edge: { source: string; target: string; type?: string },
    laneOffset: number,
    obstacles: Rect[],
  ): number => {
    const segments = segmentsFromPolyline(points)
    const bends = Math.max(0, points.length - 2)
    const length = polylineLength(points)
    const lengthMean =
      routedLengths.length > 0
        ? routedLengths.reduce((acc, item) => acc + item, 0) / routedLengths.length
        : length
    const bendsMean =
      routedBends.length > 0 ? routedBends.reduce((acc, item) => acc + item, 0) / routedBends.length : bends

    const edgeNodeOverlapPenalty = polylineHitsAnyRect(points, obstacles) ? 1 : 0
    let edgeEdgeOverlapPenalty = 0
    for (const segment of segments) {
      for (const prior of routedSegments) {
        if (!segmentsIntersect(segment, prior.segment)) continue
        edgeEdgeOverlapPenalty += prior.type === (edge.type ?? '__default__') ? 0.1 : 2.4
      }
    }

    let sameTypeCorridorBonus = 0
    let differentTypeCorridorPenalty = 0
    for (const segment of segments) {
      const segVertical = Math.abs(segment.a.x - segment.b.x) < 0.0001
      const segHorizontal = Math.abs(segment.a.y - segment.b.y) < 0.0001
      for (const prior of routedSegments) {
        const priorVertical = Math.abs(prior.segment.a.x - prior.segment.b.x) < 0.0001
        const priorHorizontal = Math.abs(prior.segment.a.y - prior.segment.b.y) < 0.0001
        if (segVertical && priorVertical) {
          if (!rangesOverlap(segment.a.y, segment.b.y, prior.segment.a.y, prior.segment.b.y)) continue
          const gap = Math.abs(segment.a.x - prior.segment.a.x)
          if (prior.type === (edge.type ?? '__default__')) {
            sameTypeCorridorBonus += Math.max(0, 1 - gap / 18)
          } else if (gap < 9) {
            differentTypeCorridorPenalty += 1 - gap / 9
          }
          continue
        }
        if (!segHorizontal || !priorHorizontal) continue
        if (!rangesOverlap(segment.a.x, segment.b.x, prior.segment.a.x, prior.segment.b.x)) continue
        const gap = Math.abs(segment.a.y - prior.segment.a.y)
        if (prior.type === (edge.type ?? '__default__')) {
          sameTypeCorridorBonus += Math.max(0, 1 - gap / 18)
        } else if (gap < 9) {
          differentTypeCorridorPenalty += 1 - gap / 9
        }
      }
    }

    let angularPenalty = 0
    if (segments.length > 0) {
      const sourceFirst = segments[0]!
      const targetLast = segments[segments.length - 1]!
      const sourceAngle = edgeDirectionAngle(sourceFirst.a, sourceFirst.b)
      const targetAngle = edgeDirectionAngle(targetLast.b, targetLast.a)
      for (const existing of sourceAngles.get(edge.source) ?? []) {
        const diff = smallestAngleDifference(sourceAngle, existing)
        angularPenalty += Math.max(0, (Math.PI / 4 - diff) / (Math.PI / 4))
      }
      for (const existing of targetAngles.get(edge.target) ?? []) {
        const diff = smallestAngleDifference(targetAngle, existing)
        angularPenalty += Math.max(0, (Math.PI / 4 - diff) / (Math.PI / 4))
      }
    }

    let labelPenalty = 0
    if (segments.length > 0) {
      const mid = segmentMidpoint(segments[Math.floor(segments.length / 2)]!)
      const labelRect = {
        x: mid.x - edgeLabelSize.width / 2,
        y: mid.y - edgeLabelSize.height / 2,
        width: edgeLabelSize.width,
        height: edgeLabelSize.height,
      }
      for (const obstacle of obstacles) {
        const overlaps =
          labelRect.x < obstacle.x + obstacle.width &&
          labelRect.x + labelRect.width > obstacle.x &&
          labelRect.y < obstacle.y + obstacle.height &&
          labelRect.y + labelRect.height > obstacle.y
        if (overlaps) labelPenalty += 1
      }
      for (const routed of routedSegments) {
        const midPoint = segmentMidpoint(routed.segment)
        if (pointInRect(midPoint, labelRect)) labelPenalty += 0.4
      }
    }

    const monotonicityPenalty = pathMonotonicityPenalty(points, direction)
    const geometryPenalty = orthogonalGeometryPenalty(points)
    const bendVariancePenalty = Math.abs(bends - bendsMean)
    const lengthVariancePenalty = Math.abs(length - lengthMean)
    const portLanePenalty = portConsistencyPenalty(
      points,
      direction,
      points[0]!,
      points[points.length - 1]!,
      laneOffset,
    )
    const manhattanFloor = Math.abs(points[points.length - 1]!.x - points[0]!.x) +
      Math.abs(points[points.length - 1]!.y - points[0]!.y)
    const unnecessaryDetourPenalty = Math.max(0, length - manhattanFloor)
    const sourceFanout = outgoingCountBySource.get(edge.source) ?? 0
    const fanoutPenalty = sourceFanout > 1
      ? earlyFanoutPenalty(points, direction) * (sourceFanout - 1)
      : 0
    const trunkScore = sharedTrunkScore(points, edge)

    return (
      bends * objectiveWeights.corners +
      polylineBoundingArea(points) * objectiveWeights.space * 0.00012 +
      length * objectiveWeights.edgeLength * 0.01 +
      unnecessaryDetourPenalty * objectiveWeights.edgeLength * 0.02 +
      lengthVariancePenalty * objectiveWeights.edgeLengthVariance * 0.01 +
      edgeNodeOverlapPenalty * objectiveWeights.edgeNodeOverlap +
      edgeEdgeOverlapPenalty * objectiveWeights.edgeEdgeOverlap +
      angularPenalty * objectiveWeights.angularResolution +
      labelPenalty * objectiveWeights.labelReadability +
      portLanePenalty * objectiveWeights.portConsistency * 0.08 +
      geometryPenalty * (objectiveWeights.corners * 0.9 + objectiveWeights.pathMonotonicity * 0.6) +
      bendVariancePenalty * objectiveWeights.bendVariance +
      monotonicityPenalty * objectiveWeights.pathMonotonicity * 0.01 +
      fanoutPenalty * objectiveWeights.pathMonotonicity * 2.3 -
      trunkScore.bonus * objectiveWeights.pathMonotonicity * 1.9 +
      trunkScore.differentTypeTooClosePenalty * objectiveWeights.pathMonotonicity * 1.25 -
      sameTypeCorridorBonus * objectiveWeights.pathMonotonicity * 0.9 +
      differentTypeCorridorPenalty * objectiveWeights.pathMonotonicity * 1.4
    )
  }

  return edges.map((edge) => {
    const { start, end } = edgeAnchorPoints(edge, nodesById, direction)
    const edgeType = edge.type ?? '__default__'
    const laneOffset = laneOffsetByEdgeId.get(edge.id) ?? 0
    const sourceFanout = outgoingCountBySource.get(edge.source) ?? 1
    const splitBias = sourceFanout > 1
      ? clamp(0.56 + (sourceFanout - 2) * 0.05, 0.56, 0.78)
      : 0.44
    const typeDelta = (edgeTypeOrder.get(edgeType) ?? 0) - typeCenter
    const gridOffsets = {
      enabled: routeOnGrid,
      size: routingGridSize,
      xOffset: typeDelta * routingGridTypeOffset,
      yOffset: typeDelta * routingGridTypeOffset,
    }
    const obstaclePadding =
      10 + objectiveWeights.edgeNodeOverlap * 3 + objectiveWeights.nodeOverlap * 2
    const obstacles = nodes
      .filter((n) => n.id !== edge.source && n.id !== edge.target)
      .map((n) => expandRect(n, obstaclePadding))
    const candidates = routeEdgeCandidates(start, end, direction, laneOffset, obstacles, splitBias, gridOffsets)
    const emergency = emergencyDetourCandidates(start, end, direction, obstacles, gridOffsets)
    const allCandidates = [...candidates, ...emergency]
    const unblockedCandidates = allCandidates.filter((c) => !polylineHitsAnyRect(c, obstacles))
    const candidatePool = unblockedCandidates.length > 0 ? unblockedCandidates : allCandidates
    let points = candidatePool[0]!
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of candidatePool) {
      const score = scoreCandidate(candidate, edge, laneOffset, obstacles)
      if (score < bestScore) {
        bestScore = score
        points = candidate
      }
    }

    const selectedSegments = segmentsFromPolyline(points)
    routedSegments.push(...selectedSegments.map((segment) => ({ segment, type: edgeType })))
    if (selectedSegments.length > 0) {
      routedHeadSegments.push({
        source: edge.source,
        type: edgeType,
        segment: selectedSegments[0]!,
      })
    }
    routedLengths.push(polylineLength(points))
    routedBends.push(Math.max(0, points.length - 2))
    if (selectedSegments.length > 0) {
      const sourceAngle = edgeDirectionAngle(selectedSegments[0]!.a, selectedSegments[0]!.b)
      const targetAngle = edgeDirectionAngle(
        selectedSegments[selectedSegments.length - 1]!.b,
        selectedSegments[selectedSegments.length - 1]!.a,
      )
      const sourceBucket = sourceAngles.get(edge.source) ?? []
      sourceBucket.push(sourceAngle)
      sourceAngles.set(edge.source, sourceBucket)
      const targetBucket = targetAngles.get(edge.target) ?? []
      targetBucket.push(targetAngle)
      targetAngles.set(edge.target, targetBucket)
    }

    return {
      ...edge,
      points,
      path: roundedPolylinePath(points, radius),
    }
  })
}

const computeBounds = (nodes: LayoutNode[]) => {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const left = Math.min(...nodes.map((n) => n.x))
  const top = Math.min(...nodes.map((n) => n.y))
  const right = Math.max(...nodes.map((n) => n.x + n.width))
  const bottom = Math.max(...nodes.map((n) => n.y + n.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const layoutGraph = <N = unknown, E = unknown>(
  graph: GraphData<N, E>,
  options: LayoutOptions = {},
): LayoutGraph<N, E> => {
  const normalized = normalizeGraph(graph)
  const nodes = layoutNodes(normalized, options)
  const edges = routeLayoutEdges<N, E>(nodes, normalized.edges, options)
  return {
    nodes,
    edges,
    bounds: computeBounds(nodes),
  }
}
