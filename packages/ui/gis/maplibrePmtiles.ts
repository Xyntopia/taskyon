import { buildPmtilesUrlCandidates } from '@taskyon/common/modules/pmtilesUtils'
import { createPmtilesOpfsSource } from '@taskyon/common/modules/pmtilesOpfsCache'
import type { Map as MapLibreMap } from 'maplibre-gl'
import maplibregl from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import { PMTiles, Protocol } from 'pmtiles'
import { defaultWorldPmtilesUrl } from './mapSources'

const protocol = new Protocol()
let protocolRegistered = false
let workerRegistered = false

export { defaultWorldPmtilesUrl }

export interface TaskyonPmtilesVectorLayerSpec {
  id: string
  url: string
  suffixes?: string[]
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

interface LoadedPmtilesSource {
  resolvedUrl: string
  metadata: unknown
  header: unknown
}

export const setupTaskyonMapLibreWorker = (): void => {
  if (workerRegistered) return
  maplibregl.setWorkerUrl(mapLibreWorkerUrl)
  workerRegistered = true
}

export const setupTaskyonPmtilesProtocol = (): void => {
  if (protocolRegistered) return
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
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

export const addRasterFallbackBaseLayer = (map: MapLibreMap): void => {
  const sourceId = 'fallback_osm_raster'
  const layerId = 'fallback_osm_raster_layer'

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    })
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0.85,
      },
    })
  }
}

export const addPmtilesVectorLayer = async (
  map: MapLibreMap,
  spec: TaskyonPmtilesVectorLayerSpec,
): Promise<void> => {
  if (map.getSource(spec.id)) return

  const loaded = await loadPmtilesSource(spec)
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
  spec: TaskyonPmtilesVectorLayerSpec,
): Promise<LoadedPmtilesSource> => {
  let lastError: unknown = null
  const candidateOptions = spec.suffixes ? { suffixes: spec.suffixes } : {}

  for (const candidate of buildPmtilesUrlCandidates(spec.url, candidateOptions)) {
    try {
      const pmtiles = new PMTiles(createPmtilesOpfsSource(candidate))
      protocol.add(pmtiles)
      const header = await pmtiles.getHeader()
      const metadata = await pmtiles.getMetadata()
      return { resolvedUrl: candidate, metadata, header }
    } catch (error) {
      lastError = error
      console.warn('[maplibrePmtiles] PMTiles candidate failed', {
        sourceId: spec.id,
        candidate,
        error,
      })
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
