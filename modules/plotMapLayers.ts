import type { Feature, Polygon } from 'geojson'
import { type PlotSparseHeatmapValue } from './plotMath'

export type MapLayerStyle = {
  color?: string
  weight?: number
  fillColor?: string
  fillOpacity?: number
  radius?: number
  fillColorProperty?: string
  lineColorProperty?: string
  circleColorProperty?: string
}

export type MapExternalFeatureLayer = {
  id: string
  features: Feature[]
  style?: MapLayerStyle
  interactive?: boolean
}

const valueToColor = (value: number, min: number, max: number): string => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return '#5e81ac'
  }
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const r = Math.round(33 + 220 * t)
  const g = Math.round(102 + 70 * (1 - Math.abs(2 * t - 1)))
  const b = Math.round(210 - 170 * t)
  return `rgb(${r},${g},${b})`
}

const edgesFromCenters = (centers: number[]): number[] => {
  if (centers.length <= 1) {
    const c = centers[0] ?? 0
    const d = 0.0005
    return [c - d, c + d]
  }

  const edges: number[] = []
  const firstStep = (centers[1] ?? centers[0]!) - centers[0]!
  edges.push(centers[0]! - firstStep / 2)
  for (let i = 0; i < centers.length - 1; i += 1) {
    const a = centers[i]!
    const b = centers[i + 1]!
    edges.push((a + b) / 2)
  }
  const lastStep = centers[centers.length - 1]! - centers[centers.length - 2]!
  edges.push(centers[centers.length - 1]! + lastStep / 2)
  return edges
}

const keyNum = (n: number): string => n.toPrecision(14)

export const buildContourLayerFromSparseHeatmap = (
  heatmap: PlotSparseHeatmapValue,
  layerId: string,
  valueProperty = '__plotValue',
): MapExternalFeatureLayer | null => {
  const xCenters = [...heatmap.xValues].sort((a, b) => a - b)
  const yCenters = [...heatmap.yValues].sort((a, b) => a - b)
  if (xCenters.length === 0 || yCenters.length === 0) return null

  const xEdges = edgesFromCenters(xCenters)
  const yEdges = edgesFromCenters(yCenters)
  const xIdx = new Map(xCenters.map((v, i) => [keyNum(v), i]))
  const yIdx = new Map(yCenters.map((v, i) => [keyNum(v), i]))

  const values = heatmap.points.map((p) => p.v).filter((v) => Number.isFinite(v))
  const vMin = values.length > 0 ? Math.min(...values) : 0
  const vMax = values.length > 0 ? Math.max(...values) : 1

  const features: Feature[] = []
  for (const p of heatmap.points) {
    const xi = xIdx.get(keyNum(p.x))
    const yi = yIdx.get(keyNum(p.y))
    if (xi == null || yi == null) continue

    const x0 = xEdges[xi]!
    const x1 = xEdges[xi + 1]!
    const y0 = yEdges[yi]!
    const y1 = yEdges[yi + 1]!
    const color = valueToColor(p.v, vMin, vMax)

    const geom: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    }

    features.push({
      type: 'Feature',
      properties: {
        [valueProperty]: p.v,
        __plotColor: color,
      },
      geometry: geom,
    })
  }

  if (features.length === 0) return null

  return {
    id: layerId,
    features,
    interactive: false,
    style: {
      color: 'transparent',
      weight: 0,
      fillOpacity: 0.65,
      fillColorProperty: '__plotColor',
    },
  }
}

const isFeatureLike = (v: unknown): v is Feature =>
  !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'Feature'

const cloneFeature = (f: Feature): Feature => JSON.parse(JSON.stringify(f)) as Feature

export const buildFeatureValueLayer = (
  runs: unknown[],
  featurePath: string,
  valuePath: string,
  getPathValue: (obj: unknown, path: string) => unknown,
  layerId: string,
  valueProperty = '__plotValue',
  objectFeaturePath?: string,
): MapExternalFeatureLayer | null => {
  const flattenMetaObject = (
    value: unknown,
    prefix: string,
    out: Record<string, unknown>,
  ): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      out[prefix] = value
      return
    }
    const rec = value as Record<string, unknown>
    for (const [k, child] of Object.entries(rec)) {
      const next = prefix ? `${prefix}.${k}` : k
      flattenMetaObject(child, next, out)
    }
  }

  const pairs: Array<{ feature: Feature; value: number | null; objectMeta?: Record<string, unknown> }> = []
  for (const run of runs) {
    const featRaw = getPathValue(run, featurePath)
    if (!isFeatureLike(featRaw)) continue
    const valRaw = valuePath ? getPathValue(run, valuePath) : undefined
    const value = typeof valRaw === 'number' ? valRaw : Number(valRaw)
    const numericValue = Number.isFinite(value) ? value : null

    let objectMeta: Record<string, unknown> | undefined
    if (objectFeaturePath) {
      const objectRaw = getPathValue(run, objectFeaturePath)
      if (objectRaw && typeof objectRaw === 'object' && !Array.isArray(objectRaw)) {
        const flat: Record<string, unknown> = {}
        flattenMetaObject(objectRaw, '', flat)
        objectMeta = flat
      }
    }

    if (numericValue == null && !objectMeta) continue
    pairs.push({
      feature: cloneFeature(featRaw),
      value: numericValue,
      ...(objectMeta ? { objectMeta } : {}),
    })
  }
  if (pairs.length === 0) return null

  const values = pairs.map((p) => p.value).filter((v): v is number => typeof v === 'number')
  const vMin = values.length > 0 ? Math.min(...values) : 0
  const vMax = values.length > 0 ? Math.max(...values) : 1

  const features: Feature[] = pairs.map(({ feature, value, objectMeta }, idx) => {
    const props = { ...(feature.properties ?? {}) }
    if (typeof value === 'number') {
      props[valueProperty] = value
      props.__plotColor = valueToColor(value, vMin, vMax)
    }
    if (objectMeta) {
      for (const [k, v] of Object.entries(objectMeta)) {
        props[`meta.${k}`] =
          typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
            ? v
            : v == null
              ? null
              : JSON.stringify(v)
      }
    }
    props.__plotRow = idx
    return {
      ...feature,
      id: feature.id ?? idx,
      properties: props,
      geometry: feature.geometry,
    }
  })

  return {
    id: layerId,
    features,
    interactive: true,
    style: {
      color: '#1f2937',
      weight: 0.8,
      fillOpacity: 0.7,
      radius: 5,
      ...(values.length > 0
        ? {
            fillColorProperty: '__plotColor',
            lineColorProperty: '__plotColor',
            circleColorProperty: '__plotColor',
          }
        : {}),
    },
  }
}

export const pickCoordinatePaths = (
  columnPaths: string[],
): { latPath: string | null; lonPath: string | null } => {
  const lower = columnPaths.map((p) => ({ path: p, low: p.toLowerCase() }))
  const pick = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const exact = lower.find((x) => x.low === c)
      if (exact) return exact.path
    }
    for (const c of candidates) {
      const suffix = lower.find((x) => x.low.endsWith(`.${c}`))
      if (suffix) return suffix.path
    }
    return null
  }

  const latPath = pick(['outputs.centerlat', 'centerlat', 'lat', 'latitude'])
  const lonPath = pick(['outputs.centerlon', 'centerlon', 'lon', 'lng', 'longitude'])
  return { latPath, lonPath }
}
