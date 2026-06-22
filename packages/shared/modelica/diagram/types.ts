export type DiagramLayoutMode = 'authored' | 'auto'

export type DiagramPoint = {
  x: number
  y: number
}

export type DiagramPlacementTransform = {
  origin?: [number, number]
  extent?: [[number, number], [number, number]]
  rotation?: number
}

export type DiagramColor = [number, number, number]

export type DiagramRectangleGraphic = {
  kind: 'Rectangle'
  extent: [[number, number], [number, number]]
  visible?: boolean
  origin?: [number, number]
  rotation?: number
  lineThickness?: number
  lineColor?: DiagramColor
  fillColor?: DiagramColor
  fillPattern?: string
}

export type DiagramEllipseGraphic = {
  kind: 'Ellipse'
  extent: [[number, number], [number, number]]
  visible?: boolean
  origin?: [number, number]
  rotation?: number
  lineThickness?: number
  lineColor?: DiagramColor
  fillColor?: DiagramColor
  fillPattern?: string
}

export type DiagramLineGraphic = {
  kind: 'Line'
  points: Array<[number, number]>
  visible?: boolean
  origin?: [number, number]
  rotation?: number
  lineThickness?: number
  color?: DiagramColor
}

export type DiagramPolygonGraphic = {
  kind: 'Polygon'
  points: Array<[number, number]>
  visible?: boolean
  origin?: [number, number]
  rotation?: number
  lineThickness?: number
  lineColor?: DiagramColor
  fillColor?: DiagramColor
  fillPattern?: string
}

export type DiagramTextGraphic = {
  kind: 'Text'
  extent?: [[number, number], [number, number]]
  textString: string
  visible?: boolean
  origin?: [number, number]
  rotation?: number
  textColor?: DiagramColor
}

export type DiagramIconGraphic =
  | DiagramRectangleGraphic
  | DiagramEllipseGraphic
  | DiagramLineGraphic
  | DiagramPolygonGraphic
  | DiagramTextGraphic

export type DiagramIconSpec = {
  coordinateExtent?: [[number, number], [number, number]]
  graphics: DiagramIconGraphic[]
}

export type DiagramComponent = {
  id: string
  name: string
  typeName: string
  qualifiedTypeName?: string
  description?: string
  iconValues?: Record<string, string>
  placement?: DiagramPlacementTransform
  iconRef?: string
  icon?: DiagramIconSpec
  ports?: DiagramPort[]
}

export type DiagramPort = {
  name: string
  typeName: string
  placement?: DiagramPlacementTransform
  icon?: DiagramIconSpec
}

export type DiagramConnection = {
  id: string
  from: string
  to: string
  fromPort?: string
  toPort?: string
  linePoints?: DiagramPoint[]
  lineColor?: DiagramColor
}

export type ModelicaDiagramDto = {
  className: string
  classIcon?: DiagramIconSpec
  components: DiagramComponent[]
  connections: DiagramConnection[]
}

export type DiagramExtractRequest = {
  source: string
  qualifiedName?: string | null
  fileName?: string | null
}

export interface ModelicaDiagramExtractor {
  extract: (request: DiagramExtractRequest) => Promise<ModelicaDiagramDto>
  extractPreview?: (request: DiagramExtractRequest) => Promise<ModelicaDiagramDto>
}
