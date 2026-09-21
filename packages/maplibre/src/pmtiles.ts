import type { Map as MapLibreMap } from 'maplibre-gl'
import maplibregl from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import { PMTiles, Protocol, type Source } from 'pmtiles'
import { buildPmtilesUrlCandidates } from './urlCandidates.js'

export const defaultWorldPmtilesUrl =
  'https://eu2.contabostorage.com/af09f5440e00407ca6d2d275a4a4dc89:protomaps/world.pmtiles'

interface TaskyonPmtilesSourceSpec {
  id: string
  url: string
  suffixes?: string[]
}

export interface TaskyonPmtilesVectorLayerSpec extends TaskyonPmtilesSourceSpec {
  baseOpacity?: number
  lineColor?: string
  lineWidth?: number
  lineOpacity?: number
  pointColor?: string
  pointOpacity?: number
  beforeLayerId?: string
  addStreetLabels?: boolean
  autoFitBounds?: boolean
  colorPalette?: string[]
  onFeatureClick?: (payload: {
    layerId: string
    sourceLayer: string
    id: unknown
    properties: Record<string, unknown>
    geometry: unknown
    lngLat: { lng: number; lat: number }
  }) => void
}

export interface TaskyonPmtilesRasterLayerSpec extends TaskyonPmtilesSourceSpec {
  tileSize?: number
  encoding?: 'terrarium' | 'mapbox'
  hillshadeExaggeration?: number
  beforeLayerId?: string
}

interface LoadedPmtilesSource {
  resolvedUrl: string
  metadata: unknown
  header: unknown
}

export type PmtilesSourceFactory = (url: string) => Source | string

export interface TaskyonPmtilesRuntime {
  setup: () => void
  dispose: () => void
  register: (source: Source | string) => PMTiles
}

export const createTaskyonPmtilesRuntime = (): TaskyonPmtilesRuntime => {
  const protocol = new Protocol()
  let installed = false

  return {
    setup: () => {
      if (installed) return
      maplibregl.setWorkerUrl(mapLibreWorkerUrl)
      maplibregl.addProtocol('pmtiles', protocol.tile)
      installed = true
    },
    dispose: () => {
      if (!installed) return
      maplibregl.removeProtocol('pmtiles')
      installed = false
    },
    register: (source) => {
      const pmtiles = new PMTiles(source)
      protocol.add(pmtiles)
      return pmtiles
    },
  }
}

export const parsePmtilesVectorLayerNames = (metadata: unknown): string[] => {
  if (!metadata || typeof metadata !== 'object') return []

  const raw = (metadata as Record<string, unknown>).vector_layers
  const decoded = typeof raw === 'string' ? parseJson(raw) : raw
  if (!Array.isArray(decoded)) return []

  return decoded
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const id = (entry as Record<string, unknown>).id
      return typeof id === 'string' ? id : null
    })
    .filter((id): id is string => !!id)
}

export const parsePmtilesBounds = (
  metadata: unknown,
  header: unknown,
): [number, number, number, number] | null =>
  parseBoundsFromMetadata(metadata) ?? parseBoundsFromHeader(header)

export const addPmtilesVectorLayer = async (
  runtime: TaskyonPmtilesRuntime,
  map: MapLibreMap,
  spec: TaskyonPmtilesVectorLayerSpec,
  sourceFactory?: PmtilesSourceFactory,
): Promise<void> => {
  if (map.getSource(spec.id)) return

  const loaded = await loadPmtilesSource(runtime, spec, sourceFactory)
  const sourceLayers = parsePmtilesVectorLayerNames(loaded.metadata)
  const bounds = parsePmtilesBounds(loaded.metadata, loaded.header)

  map.addSource(spec.id, {
    type: 'vector',
    url: `pmtiles://${loaded.resolvedUrl}`,
  })

  sourceLayers.forEach((sourceLayer, idx) => {
    addAutoLayersForSourceLayer(map, spec, sourceLayer, idx)
  })

  if (spec.addStreetLabels) {
    addStreetLabelLayers(map, spec, sourceLayers)
  }

  if (spec.autoFitBounds && bounds) {
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 24,
        duration: 0,
        maxZoom: 11,
      },
    )
  }
}

export const addPmtilesRasterLayer = async (
  runtime: TaskyonPmtilesRuntime,
  map: MapLibreMap,
  spec: TaskyonPmtilesRasterLayerSpec,
  sourceFactory?: PmtilesSourceFactory,
): Promise<void> => {
  if (map.getSource(spec.id)) return

  const loaded = await loadPmtilesSource(runtime, spec, sourceFactory)
  map.addSource(spec.id, {
    type: 'raster-dem',
    url: `pmtiles://${loaded.resolvedUrl}`,
    tileSize: spec.tileSize ?? 512,
    encoding: spec.encoding ?? 'terrarium',
  })

  map.addLayer(
    {
      id: `${spec.id}_hillshade`,
      type: 'hillshade',
      source: spec.id,
      paint: {
        'hillshade-exaggeration': spec.hillshadeExaggeration ?? 0.35,
      },
    },
    spec.beforeLayerId,
  )
}

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const parseBoundsTuple = (arr: unknown[]): [number, number, number, number] | null => {
  if (arr.length < 4) return null
  const values = arr.slice(0, 4).map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) return null
  return [values[0]!, values[1]!, values[2]!, values[3]!]
}

const parseBoundsFromMetadata = (metadata: unknown): [number, number, number, number] | null => {
  if (!metadata || typeof metadata !== 'object') return null

  const rawBounds = (metadata as Record<string, unknown>).bounds
  if (Array.isArray(rawBounds)) return parseBoundsTuple(rawBounds)
  if (typeof rawBounds === 'string') {
    return parseBoundsTuple(rawBounds.split(',').map((value) => value.trim()))
  }

  return null
}

const parseBoundsFromHeader = (header: unknown): [number, number, number, number] | null => {
  if (!header || typeof header !== 'object') return null
  const raw = header as Record<string, unknown>
  const minLon = Number(raw.minLon)
  const minLat = Number(raw.minLat)
  const maxLon = Number(raw.maxLon)
  const maxLat = Number(raw.maxLat)

  if (![minLon, minLat, maxLon, maxLat].every((value) => Number.isFinite(value))) return null
  if (minLon >= maxLon || minLat >= maxLat) return null
  return [minLon, minLat, maxLon, maxLat]
}

const loadPmtilesSource = async (
  runtime: TaskyonPmtilesRuntime,
  spec: TaskyonPmtilesSourceSpec,
  sourceFactory?: PmtilesSourceFactory,
): Promise<LoadedPmtilesSource> => {
  let lastError: unknown = null
  const candidateOptions = spec.suffixes ? { suffixes: spec.suffixes } : {}

  for (const candidate of buildPmtilesUrlCandidates(spec.url, candidateOptions)) {
    try {
      const pmtiles = runtime.register(sourceFactory?.(candidate) ?? candidate)
      const header = await pmtiles.getHeader()
      const metadata = await pmtiles.getMetadata()
      return { resolvedUrl: candidate, metadata, header }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Failed to load PMTiles metadata for ${spec.id}`)
}

const getLayerColor = (spec: TaskyonPmtilesVectorLayerSpec, index: number): string => {
  const palette = spec.colorPalette ?? [
    '#3f4953',
    '#495662',
    '#55616c',
    '#606b75',
    '#6a7580',
    '#737f89',
  ]
  return palette[index % palette.length] ?? '#55616c'
}

const addAutoLayersForSourceLayer = (
  map: MapLibreMap,
  spec: TaskyonPmtilesVectorLayerSpec,
  sourceLayer: string,
  index: number,
): void => {
  const fillId = `${spec.id}_${sourceLayer}_fill`
  const lineId = `${spec.id}_${sourceLayer}_line`
  const pointId = `${spec.id}_${sourceLayer}_point`
  const layerColor = getLayerColor(spec, index)

  map.addLayer(
    {
      id: fillId,
      type: 'fill',
      source: spec.id,
      'source-layer': sourceLayer,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': layerColor,
        'fill-opacity': spec.baseOpacity ?? 0.04,
      },
    },
    spec.beforeLayerId,
  )

  map.addLayer(
    {
      id: lineId,
      type: 'line',
      source: spec.id,
      'source-layer': sourceLayer,
      paint: {
        'line-color': spec.lineColor ?? '#93a1af',
        'line-width': spec.lineWidth ?? 0.8,
        'line-opacity': spec.lineOpacity ?? 0.45,
      },
    },
    spec.beforeLayerId,
  )

  map.addLayer(
    {
      id: pointId,
      type: 'circle',
      source: spec.id,
      'source-layer': sourceLayer,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': spec.pointColor ?? '#e5e7eb',
        'circle-radius': 2,
        'circle-opacity': spec.pointOpacity ?? 0.35,
      },
    },
    spec.beforeLayerId,
  )

  if (spec.onFeatureClick) {
    ;[fillId, lineId, pointId].forEach((layerId) => {
      map.on('click', layerId, (event) => {
        const clicked = event.features?.[0]
        spec.onFeatureClick?.({
          layerId,
          sourceLayer,
          id: clicked?.id ?? null,
          properties: clicked?.properties ?? {},
          geometry: clicked?.geometry ?? null,
          lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat },
        })
      })
    })
  }
}

const addStreetLabelLayers = (
  map: MapLibreMap,
  spec: TaskyonPmtilesVectorLayerSpec,
  sourceLayers: string[],
): void => {
  sourceLayers
    .filter((layerName) => /(road|street|transport|highway)/i.test(layerName))
    .forEach((sourceLayer) => {
      const layerId = `${spec.id}_${sourceLayer}_street_name`
      if (map.getLayer(layerId)) return

      map.addLayer(
        {
          id: layerId,
          type: 'symbol',
          source: spec.id,
          'source-layer': sourceLayer,
          filter: ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'name']],
          layout: {
            'symbol-placement': 'line',
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 12],
            'text-font': ['Noto Sans Regular'],
            'text-max-angle': 30,
            'text-padding': 2,
          },
          paint: {
            'text-color': '#d1d5db',
            'text-halo-color': '#0b0f14',
            'text-halo-width': 1.2,
          },
          minzoom: 11,
        },
        spec.beforeLayerId,
      )
    })
}
