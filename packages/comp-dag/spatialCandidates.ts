import z from 'zod'
import { iterateCandidatePatches, type GridOrder } from './candidateOrder.ts'
import type { SpatialCandidateDomain } from './optimization.ts'

const positionSchema = z.array(z.number().finite()).min(2)
const ringSchema = z.array(positionSchema).min(4)
const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(ringSchema).min(1),
})
const multiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
})
const geometrySchema = z.union([polygonSchema, multiPolygonSchema])
const featureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  geometry: geometrySchema,
})

type PolygonFeature = z.infer<typeof featureSchema>
type Geometry = PolygonFeature['geometry']
type Bounds = { west: number; east: number; south: number; north: number }

export const spatialCandidateSchema = z.object({
  lat: z.number().finite(),
  lon: z.number().finite(),
  gridKey: z.string().nullable(),
  gridLevel: z.number().int().nonnegative().nullable(),
  featureIds: z.array(z.string()),
  feature: featureSchema.optional(),
  featureSourceIndex: z.number().int().nonnegative().optional(),
})
export type SpatialCandidate = z.infer<typeof spatialCandidateSchema>

const featureId = (feature: PolygonFeature, sourceIndex: number) =>
  String(feature.id ?? feature.properties?.parcelid ?? feature.properties?.id ?? sourceIndex)

const polygonsOf = (geometry: Geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

const boundsOf = (geometry: Geometry): Bounds => {
  const points = polygonsOf(geometry).flat(2)
  return {
    west: Math.min(...points.map((point) => point[0]!)),
    east: Math.max(...points.map((point) => point[0]!)),
    south: Math.min(...points.map((point) => point[1]!)),
    north: Math.max(...points.map((point) => point[1]!)),
  }
}

const ringContains = (ring: number[][], lon: number, lat: number) => {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!
    const b = ring[previous]!
    if (a[1]! > lat !== b[1]! > lat) {
      const crossing = a[0]! + ((lat - a[1]!) * (b[0]! - a[0]!)) / (b[1]! - a[1]!)
      if (lon < crossing) inside = !inside
    }
  }
  return inside
}

const geometryContains = (geometry: Geometry, lon: number, lat: number) =>
  polygonsOf(geometry).some(
    (rings) =>
      ringContains(rings[0]!, lon, lat) &&
      rings.slice(1).every((hole) => !ringContains(hole, lon, lat)),
  )

const interiorPoint = (geometry: Geometry): { lat: number; lon: number } => {
  const bounds = boundsOf(geometry)
  const center = { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 }
  if (geometryContains(geometry, center.lon, center.lat)) return center
  for (const polygon of polygonsOf(geometry)) {
    const ring = polygon[0]!
    const latitudes = [
      center.lat,
      ...ring.slice(1).map((point, index) => (point[1]! + ring[index]![1]!) / 2),
    ]
    for (const lat of latitudes) {
      const crossings = ring
        .flatMap((point, index) => {
          const next = ring[(index + 1) % ring.length]!
          return point[1]! > lat !== next[1]! > lat
            ? [point[0]! + ((lat - point[1]!) * (next[0]! - point[0]!)) / (next[1]! - point[1]!)]
            : []
        })
        .sort((left, right) => left - right)
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        for (const fraction of [0.5, 0.25, 0.75]) {
          const lon = crossings[index]! + fraction * (crossings[index + 1]! - crossings[index]!)
          if (geometryContains(geometry, lon, lat)) return { lat, lon }
        }
      }
    }
  }
  throw new Error('Polygon has no usable interior point.')
}

const latticePoint = (
  domain: SpatialCandidateDomain,
  latIndex: number,
  lonIndex: number,
): { lat: number; lon: number; gridKey: string } => {
  const scale = 2 ** domain.grid.levels
  return {
    lat: domain.grid.originLat + latIndex * (domain.grid.stepLatDeg / scale),
    lon: domain.grid.originLon + lonIndex * (domain.grid.stepLonDeg / scale),
    gridKey: `${latIndex}:${lonIndex}`,
  }
}

const pointForFeature = (domain: SpatialCandidateDomain, feature: PolygonFeature) => {
  const anchor = interiorPoint(feature.geometry)
  for (let level = 0; level <= domain.grid.levels; level += 1) {
    const stride = 2 ** (domain.grid.levels - level)
    const latIndex = Math.round(
      (anchor.lat - domain.grid.originLat) / (domain.grid.stepLatDeg / 2 ** level),
    )
    const lonIndex = Math.round(
      (anchor.lon - domain.grid.originLon) / (domain.grid.stepLonDeg / 2 ** level),
    )
    for (const [dLat, dLon] of [
      [0, 0],
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const point = latticePoint(domain, (latIndex + dLat!) * stride, (lonIndex + dLon!) * stride)
      if (geometryContains(feature.geometry, point.lon, point.lat)) {
        return { ...point, gridLevel: level }
      }
    }
  }
  return { ...anchor, gridKey: null, gridLevel: null }
}

const gridLevel = (index: number, length: number) => {
  let stride = 1
  while (stride * 2 < length) stride *= 2
  let level = 0
  while (stride > 1 && index % stride !== 0) {
    stride /= 2
    level += 1
  }
  return level
}

export const iterateSpatialCandidates = function* (args: {
  domain: SpatialCandidateDomain
  features: Array<{ sourceIndex: number; value: unknown }>
  params: Record<string, unknown>
  readPath: (source: unknown, path: string) => unknown
  order: GridOrder
}): Iterable<SpatialCandidate> {
  const { domain } = args
  const features = args.features.map(({ sourceIndex, value }) => ({
    sourceIndex,
    feature: featureSchema.parse(value),
  }))
  if (domain.mode === 'perFeature') {
    if (!domain.featureAlias) throw new Error('Per-feature spatial study requires a feature input.')
    for (const { sourceIndex, feature } of features) {
      const point = pointForFeature(domain, feature)
      yield {
        ...point,
        featureIds: [featureId(feature, sourceIndex)],
        feature,
        featureSourceIndex: sourceIndex,
      }
    }
    return
  }
  const regionRaw = domain.regionPath ? args.readPath(args.params, domain.regionPath) : undefined
  const region = regionRaw === undefined ? undefined : featureSchema.parse(regionRaw).geometry
  if (!region && features.length === 0) throw new Error('Grid study requires an area or features.')
  const boundsList = region
    ? [boundsOf(region)]
    : features.map(({ feature }) => boundsOf(feature.geometry))
  const bounds = {
    west: Math.min(...boundsList.map((item) => item.west)),
    east: Math.max(...boundsList.map((item) => item.east)),
    south: Math.min(...boundsList.map((item) => item.south)),
    north: Math.max(...boundsList.map((item) => item.north)),
  }
  const fineLat = domain.grid.stepLatDeg / 2 ** domain.grid.levels
  const fineLon = domain.grid.stepLonDeg / 2 ** domain.grid.levels
  const latStart = Math.ceil((bounds.south - domain.grid.originLat) / fineLat)
  const lonStart = Math.ceil((bounds.west - domain.grid.originLon) / fineLon)
  const latLength = Math.floor((bounds.north - domain.grid.originLat) / fineLat) - latStart + 1
  const lonLength = Math.floor((bounds.east - domain.grid.originLon) / fineLon) - lonStart + 1
  if (latLength <= 0 || lonLength <= 0) return
  for (const patch of iterateCandidatePatches(
    [
      {
        path: 'latIndex',
        kind: 'grid',
        length: latLength,
        offset: latStart,
        valueAt: (index) => index,
      },
      {
        path: 'lonIndex',
        kind: 'grid',
        length: lonLength,
        offset: lonStart,
        valueAt: (index) => index,
      },
    ],
    args.order,
  )) {
    const latIndex = Number(patch.latIndex)
    const lonIndex = Number(patch.lonIndex)
    const point = latticePoint(domain, latStart + latIndex, lonStart + lonIndex)
    if (region && !geometryContains(region, point.lon, point.lat)) continue
    const matches = features.filter(({ feature }) =>
      geometryContains(feature.geometry, point.lon, point.lat),
    )
    if (!region && matches.length === 0) continue
    yield {
      ...point,
      gridLevel: Math.max(
        gridLevel(latStart + latIndex, latLength),
        gridLevel(lonStart + lonIndex, lonLength),
      ),
      featureIds: matches.map(({ sourceIndex, feature }) => featureId(feature, sourceIndex)),
      ...(matches.length === 1
        ? { feature: matches[0]!.feature, featureSourceIndex: matches[0]!.sourceIndex }
        : {}),
    }
  }
}
