import type { Feature, Point, Polygon } from 'geojson'
import { type PlotFlatRow, type PlotSparseHeatmapValue } from './plotMath'
import { z } from 'zod'

const createMapCategoryStylesSchema = () =>
  z.record(
    z.string(),
    z
      .object({
        label: z.string().min(1).max(200),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .strict(),
  )

export type MapCategoryStyles = z.infer<ReturnType<typeof createMapCategoryStylesSchema>>

export const createMapCategoryStylesJsonSchema = () =>
  z.toJSONSchema(createMapCategoryStylesSchema(), { target: 'draft-7' })

export const normalizeMapCategoryStyles = (value: unknown): MapCategoryStyles | undefined => {
  const parsed = createMapCategoryStylesSchema().safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Offline outline preview for WGS84 polygons. This display projection must not be used for area. */
export const renderPolygonMapSvg = (
  collection: unknown,
  options: { title?: string; description?: string } = {},
): string => {
  const escapeText = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[char]!,
    )
  const title = escapeText(options.title ?? 'Parcel outlines · WGS84 · north up')
  const description = escapeText(
    options.description ??
      'Whole parcel outlines; not certified facility footprints. Display only, not an area calculation.',
  )
  const position = z
    .tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
    .rest(z.number().finite())
  const ring = z
    .array(position)
    .min(4)
    .refine(
      (points) => points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1],
      'Polygon rings must close.',
    )
  const polygon = z.array(ring).min(1)
  const parsed = z
    .object({
      type: z.literal('FeatureCollection'),
      features: z.array(
        z.object({
          type: z.literal('Feature'),
          geometry: z.discriminatedUnion('type', [
            z.object({ type: z.literal('Polygon'), coordinates: polygon }),
            z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }),
          ]),
        }),
      ),
    })
    .parse(collection)
  const polygons = parsed.features.flatMap(({ geometry }) =>
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates,
  )
  const points = polygons.flat(2)
  if (!points.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720"><text x="24" y="36">${title}: no polygons.</text></svg>`
  const { minLon, maxLon, minLat, maxLat } = points.reduce(
    (bounds, [lon, lat]) => ({
      minLon: Math.min(bounds.minLon, lon),
      maxLon: Math.max(bounds.maxLon, lon),
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity },
  )
  const longitudeScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const width = (maxLon - minLon) * longitudeScale
  const height = maxLat - minLat
  const scale = Math.min(880 / Math.max(width, 1e-9), 620 / Math.max(height, 1e-9))
  const paths = polygons
    .map((rings) => {
      const path = rings
        .map(
          (points) =>
            points
              .map(
                ([lon, lat], index) =>
                  `${index ? 'L' : 'M'}${(40 + (lon - minLon) * longitudeScale * scale).toFixed(2)},${(60 + (maxLat - lat) * scale).toFixed(2)}`,
              )
              .join(' ') + ' Z',
        )
        .join(' ')
      return `<path d="${path}" fill-rule="evenodd"/>`
    })
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" role="img" aria-label="${title}">
<rect width="960" height="720" fill="white"/><text x="40" y="30" font-family="sans-serif" font-size="20">${title}</text>
<g fill="#5e81ac" fill-opacity="0.2" stroke="#1f2937" stroke-width="1">${paths}</g>
<text x="40" y="706" font-family="sans-serif" font-size="12">${description}</text></svg>`
}

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
  legend?: Array<{ label: string; color: string }>
}

export const mapCategoryColor = (category: string): string => {
  // A category keeps its color when rows are reordered or a scenario removes other categories.
  const hue = [...category].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 360,
    0,
  )
  return `hsl(${(hue * 137.508) % 360},55%,60%)`
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

export const buildCoordinatePointLayer = (args: {
  rows: PlotFlatRow[]
  latPath: string
  lonPath: string
  valuePath?: string
  labelPath?: string
  layerId: string
}): MapExternalFeatureLayer | null => {
  const sites = new Map<
    string,
    { lat: number; lon: number; value: number | null; label?: string }
  >()
  for (const row of args.rows) {
    const rawLat = row[args.latPath]
    const rawLon = row[args.lonPath]
    if (rawLat === null || rawLat === undefined || rawLat === '') continue
    if (rawLon === null || rawLon === undefined || rawLon === '') continue
    const lat = Number(rawLat)
    const lon = Number(rawLon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      continue
    const rawValue = args.valuePath ? Number(row[args.valuePath]) : null
    const value = rawValue !== null && Number.isFinite(rawValue) ? rawValue : null
    if (args.valuePath && value === null) continue
    const label = args.labelPath ? row[args.labelPath] : undefined
    const name = typeof label === 'string' ? label : undefined
    sites.set(JSON.stringify([lat, lon, value, name]), {
      lat,
      lon,
      value,
      ...(name ? { label: name } : {}),
    })
  }
  if (sites.size === 0) return null

  const points = [...sites.values()]
  const values = points.map(({ value }) => value).filter((value): value is number => value !== null)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const features: Feature<Point>[] = points.map(({ lat, lon, value, label }, index) => ({
    type: 'Feature',
    id: index,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      ...(label ? { label } : {}),
      ...(value === null ? {} : { __plotValue: value, __plotColor: valueToColor(value, min, max) }),
    },
  }))
  return {
    id: args.layerId,
    features,
    interactive: true,
    style: {
      color: '#1f2937',
      radius: 8,
      circleColorProperty: '__plotColor',
    },
  }
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

const readFlatFeature = (run: unknown, path: string): Feature | null => {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return null
  const row = run as Record<string, unknown>
  if (row[`${path}.type`] !== 'Feature') return null
  const type = row[`${path}.geometry.type`]
  const coordinates = row[`${path}.geometry.coordinates`]
  if (typeof type !== 'string' || !Array.isArray(coordinates)) return null
  const prefix = `${path}.properties.`
  const properties = Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  )
  return {
    type: 'Feature',
    geometry: { type, coordinates } as Feature['geometry'],
    properties,
  }
}

const pathValue = (
  run: unknown,
  path: string,
  getPathValue: (obj: unknown, path: string) => unknown,
) => {
  const nested = getPathValue(run, path)
  if (nested !== undefined) return nested
  return run && typeof run === 'object' && !Array.isArray(run)
    ? (run as Record<string, unknown>)[path]
    : undefined
}

export const buildFeatureValueLayer = (
  runs: unknown[],
  featurePath: string,
  valuePath: string,
  getPathValue: (obj: unknown, path: string) => unknown,
  layerId: string,
  valueProperty = '__plotValue',
  objectFeaturePath?: string,
  categoryStyles?: MapCategoryStyles,
  selection: { featureValuePath?: string | undefined; rowIndex?: number | undefined } = {},
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

  const pairs: Array<{
    feature: Feature
    value: number | null
    category?: string
    objectMeta?: Record<string, unknown>
    rowIndex: number
  }> = []
  for (const [rowIndex, run] of runs.entries()) {
    if (selection.rowIndex !== undefined && rowIndex !== selection.rowIndex) continue
    const featRaw = pathValue(run, featurePath, getPathValue) ?? readFlatFeature(run, featurePath)
    const collectionType = pathValue(run, `${featurePath}.type`, getPathValue)
    const collectionFeatures =
      collectionType === 'FeatureCollection'
        ? pathValue(run, `${featurePath}.features`, getPathValue)
        : undefined
    if (Array.isArray(collectionFeatures) && runs.length > 1 && selection.rowIndex === undefined)
      throw new Error('Select a result row before plotting multiple feature collections.')
    const features = Array.isArray(collectionFeatures)
      ? collectionFeatures.filter(isFeatureLike)
      : isFeatureLike(featRaw)
        ? [featRaw]
        : []
    for (const feature of features) {
      const valRaw = selection.featureValuePath
        ? pathValue(feature, selection.featureValuePath, getPathValue)
        : valuePath
          ? pathValue(run, valuePath, getPathValue)
          : undefined
      const value =
        typeof valRaw === 'number'
          ? valRaw
          : typeof valRaw === 'string' && valRaw.trim()
            ? Number(valRaw)
            : Number.NaN
      const numericValue = Number.isFinite(value) ? value : null
      const category =
        numericValue === null && typeof valRaw === 'string' && valRaw.trim()
          ? valRaw.trim()
          : undefined

      let objectMeta: Record<string, unknown> | undefined
      if (objectFeaturePath) {
        const objectRaw = pathValue(run, objectFeaturePath, getPathValue)
        if (objectRaw && typeof objectRaw === 'object' && !Array.isArray(objectRaw)) {
          const flat: Record<string, unknown> = {}
          flattenMetaObject(objectRaw, '', flat)
          objectMeta = flat
        }
      }

      if (numericValue == null && !category && !objectMeta) continue
      pairs.push({
        feature: cloneFeature(feature),
        value: numericValue,
        rowIndex,
        ...(category ? { category } : {}),
        ...(objectMeta ? { objectMeta } : {}),
      })
    }
  }
  if (pairs.length === 0) return null

  const values = pairs.map((p) => p.value).filter((v): v is number => typeof v === 'number')
  const vMin = values.length > 0 ? Math.min(...values) : 0
  const vMax = values.length > 0 ? Math.max(...values) : 1

  const legend = [...new Set(pairs.flatMap(({ category }) => (category ? [category] : [])))]
    .sort()
    .map((category) => ({
      label: categoryStyles?.[category]?.label ?? category,
      color: categoryStyles?.[category]?.color ?? mapCategoryColor(category),
    }))
  const features: Feature[] = pairs.map(
    ({ feature, value, category, objectMeta, rowIndex }, idx) => {
      const props = { ...(feature.properties ?? {}) }
      if (typeof value === 'number') {
        props[valueProperty] = value
        props.__plotColor = valueToColor(value, vMin, vMax)
      }
      if (category) {
        props.__plotCategory = category
        props.__plotColor = categoryStyles?.[category]?.color ?? mapCategoryColor(category)
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
      props.__plotRow = rowIndex
      return {
        ...feature,
        id: feature.id ?? idx,
        properties: props,
        geometry: feature.geometry,
      }
    },
  )

  return {
    id: layerId,
    features,
    interactive: true,
    ...(legend.length ? { legend } : {}),
    style: {
      color: '#1f2937',
      weight: 0.8,
      fillOpacity: legend.length > 0 ? 1 : 0.7,
      radius: 5,
      ...(values.length > 0 || legend.length > 0
        ? {
            fillColorProperty: '__plotColor',
            ...(legend.length === 0 ? { lineColorProperty: '__plotColor' } : {}),
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
