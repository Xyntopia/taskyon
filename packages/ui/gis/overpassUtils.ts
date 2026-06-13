import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson'

export interface TaginfoResult {
  key: string
  value?: string
  count: number
  fraction: number
}

interface TaginfoResponse {
  data: TaginfoResult[]
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: {
    lat: number
    lon: number
  }
  geometry?: Array<{
    lat: number
    lon: number
  }>
  tags?: Record<string, string | undefined>
}

export interface StructuredOverpassResult {
  overpassQuery: string
  searchType?: string
}

const searchTaginfoEndpoint = async (endpoint: string, query: string): Promise<TaginfoResult[]> => {
  try {
    const url = `https://taginfo.openstreetmap.org/api/4/${endpoint}/search?q=${encodeURIComponent(query)}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Taginfo request failed with status ${response.status}`)
    const payload = (await response.json()) as TaginfoResponse
    return payload.data ?? []
  } catch {
    return []
  }
}

export const searchTaginfo = async (query: string): Promise<TaginfoResult[]> => {
  const [tags, keys, values] = await Promise.all([
    searchTaginfoEndpoint('tags', query),
    searchTaginfoEndpoint('keys', query),
    searchTaginfoEndpoint('values', query),
  ])

  return [...tags, ...keys, ...values]
    .filter(
      (result, index, all) =>
        all.findIndex(
          (candidate) => candidate.key === result.key && candidate.value === result.value,
        ) === index,
    )
    .sort((left, right) => right.count - left.count)
}

export const makeTaginfoContext = (results: TaginfoResult[]) =>
  results
    .slice(0, 10)
    .map((result) =>
      result.value
        ? `"${result.key}"="${result.value}" (${result.count} uses)`
        : `"${result.key}" (${result.count} uses)`,
    )
    .join(', ')

export const isStructuredOverpassResult = (value: unknown): value is StructuredOverpassResult =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { overpassQuery?: unknown }).overpassQuery === 'string' &&
  ((value as { searchType?: unknown }).searchType === undefined ||
    typeof (value as { searchType?: unknown }).searchType === 'string')

const isClosedRing = (coordinates: [number, number][]) => {
  if (coordinates.length < 4) return false
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  return !!first && !!last && first[0] === last[0] && first[1] === last[1]
}

const geometryToFeature = (element: OverpassElement): Feature | null => {
  const properties = {
    osmId: element.id,
    osmType: element.type,
    ...(element.tags ?? {}),
  }

  if (
    element.type === 'node' &&
    typeof element.lat === 'number' &&
    typeof element.lon === 'number'
  ) {
    const geometry: Point = {
      type: 'Point',
      coordinates: [element.lon, element.lat],
    }
    return { type: 'Feature', properties, geometry }
  }

  if (Array.isArray(element.geometry) && element.geometry.length > 0) {
    const coordinates = element.geometry.map((entry) => [entry.lon, entry.lat] as [number, number])

    const geometry: Geometry = isClosedRing(coordinates)
      ? ({
          type: 'Polygon',
          coordinates: [coordinates],
        } satisfies Polygon)
      : ({
          type: 'LineString',
          coordinates,
        } satisfies LineString)

    return { type: 'Feature', properties, geometry }
  }

  if (element.center) {
    const geometry: Point = {
      type: 'Point',
      coordinates: [element.center.lon, element.center.lat],
    }
    return { type: 'Feature', properties, geometry }
  }

  return null
}

export const overpassToFeatureCollection = (elements: OverpassElement[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: elements.map(geometryToFeature).filter((entry): entry is Feature => !!entry),
})

const getOverpassInterpreterUrl = () => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.TASKYON_OVERPASS_INTERPRETER_URL ?? 'https://overpass-api.de/api/interpreter'
}

export const fetchOverpassElements = async (overpassQuery: string): Promise<OverpassElement[]> => {
  const response = await fetch(getOverpassInterpreterUrl(), {
    method: 'POST',
    body: overpassQuery,
    headers: {
      'Content-Type': 'text/plain',
    },
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] }
  return Array.isArray(payload.elements) ? payload.elements : []
}
