export type GraphDirection = 'TB' | 'LR'
export type GraphLayoutMode = 'hierarchical' | 'organic'

export type GraphNode<T = unknown> = {
  id: string
  type?: string
  label?: string
  data?: T
}

export type GraphEdge<T = unknown> = {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  data?: T
}

export type GraphData<N = unknown, E = unknown> = {
  nodes: GraphNode<N>[]
  edges: GraphEdge<E>[]
}

export type NodeRect = {
  x: number
  y: number
  width: number
  height: number
}

export type LayoutNode<N = unknown> = GraphNode<N> &
  NodeRect & {
    layer: number
    order: number
  }

export type LayoutEdge<E = unknown> = GraphEdge<E> & {
  points: Array<{ x: number; y: number }>
  path: string
}

export type LayoutGraph<N = unknown, E = unknown> = {
  nodes: LayoutNode<N>[]
  edges: LayoutEdge<E>[]
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type NodeStyle = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  rx?: number
  ry?: number
  textColor?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  glowColor?: string
  glowBlur?: number
}

export type EdgeStyle = {
  stroke?: string
  strokeWidth?: number
  dasharray?: string
  opacity?: number
  glowColor?: string
  glowBlur?: number
}

export type GraphTheme = {
  defaultNodeStyle?: NodeStyle
  defaultEdgeStyle?: EdgeStyle
  nodeStyles?: Record<string, NodeStyle>
  edgeStyles?: Record<string, EdgeStyle>
}

export type LayoutOptions = {
  layoutMode?: GraphLayoutMode
  direction?: GraphDirection
  layerGap?: number
  nodeGap?: number
  margin?: number
  nodeWidth?: number | ((node: GraphNode) => number)
  nodeHeight?: number | ((node: GraphNode) => number)
  adaptNodeToContent?: boolean
  uniformNodeSizeByType?: boolean
  contentFontSize?: number
  cornerRadius?: number
  optimizeLayout?: boolean
  crossingMinimizationPasses?: number
  transposePasses?: number
  previousNodePositions?: Record<string, { x: number; y: number }>
  fixedNodeRects?: Record<string, { x: number; y: number; width?: number; height?: number }>
  authoredNodePositions?: Record<string, { x: number; y: number; width?: number; height?: number }>
  edgeLabelSize?: { width: number; height: number }
  routeOnGrid?: boolean
  routingGridSize?: number
  routingGridTypeOffset?: number
  objectiveWeights?: {
    crossings?: number
    span?: number
    corners?: number
    space?: number
    edgeLength?: number
    edgeLengthVariance?: number
    nodeOverlap?: number
    edgeNodeOverlap?: number
    edgeEdgeOverlap?: number
    angularResolution?: number
    nodeDistance?: number
    symmetry?: number
    stability?: number
    hierarchyAlignment?: number
    labelReadability?: number
    portConsistency?: number
    bendVariance?: number
    pathMonotonicity?: number
  }
}

export type InteractionOptions<N = unknown, E = unknown> = {
  enablePanZoom?: boolean
  enableNodeDrag?: boolean
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  onNodeClick?: (node: LayoutNode<N>) => void
  onNodeDoubleClick?: (node: LayoutNode<N>) => void
  onNodeContextMenu?: (node: LayoutNode<N>, location: { clientX: number; clientY: number }) => void
  edgeTooltipHtml?: (edge: LayoutEdge<E>) => string | null | undefined
  nodeTooltipHtml?: (node: LayoutNode<N>) => string | null | undefined
}

export type RenderOptions<N = unknown, E = unknown> = LayoutOptions &
  InteractionOptions<N, E> & {
    theme?: GraphTheme
    nodeHtml?: (node: LayoutNode<N>) => string | HTMLElement | null | undefined
    nodeSvg?: (node: LayoutNode<N>) => string | SVGElement | null | undefined
    nodeStyle?: (node: LayoutNode<N>) => NodeStyle | undefined
    nodeHoverStyle?: (node: LayoutNode<N>) => NodeStyle | undefined
    edgeStyle?: (edge: LayoutEdge<E>) => EdgeStyle | undefined
    showDefaultNodeLabel?: boolean
    nodeHtmlPointerEvents?: 'none' | 'auto'
  }
