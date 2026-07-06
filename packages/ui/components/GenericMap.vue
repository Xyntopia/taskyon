<!-- src/components/GenericMap.vue -->
<template>
  <div class="generic-map-wrapper" :class="{ 'sidebar-open': !!$slots.sidebar && sidebarOpen }">
    <div ref="mapEl" class="generic-map-root" />
    <div v-if="mapInitError" class="generic-map-error">
      <div class="generic-map-error-title">Map unavailable</div>
      <div class="generic-map-error-body">{{ mapInitError }}</div>
    </div>

    <button
      v-if="$slots.sidebar"
      type="button"
      class="generic-map-sidebar-toggle"
      @click="toggleSidebar"
    >
      <span v-if="sidebarOpen">⟨</span>
      <span v-else>⟩</span>
    </button>

    <transition name="generic-map-sidebar">
      <div v-if="$slots.sidebar && sidebarOpen" class="generic-map-sidebar">
        <slot name="sidebar" />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import type { StyleSpecification } from 'maplibre-gl'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import { PMTiles, Protocol } from 'pmtiles'
import { createPmtilesOpfsSource } from '@taskyon/common/modules/pmtilesOpfsCache'
import { onBeforeUnmount, onMounted, ref, useSlots } from 'vue'

const WORLD_PM_URL =
  'https://eu2.contabostorage.com/af09f5440e00407ca6d2d275a4a4dc89:protomaps/world.pmtiles'
const PARCELS_PM_URL =
  'https://eu2.contabostorage.com/af09f5440e00407ca6d2d275a4a4dc89:parcels-temp/parcels.pmtiles'

const protocol = new Protocol()
let protocolRegistered = false
let workerRegistered = false

const setupPmtilesProtocol = () => {
  if (protocolRegistered) return
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

const setupMapLibreWorker = () => {
  if (workerRegistered) return
  maplibregl.setWorkerUrl(mapLibreWorkerUrl)
  workerRegistered = true
}

const getPmtilesUrlCandidates = (url: string, sourceId: string): string[] => {
  const trimmed = url.trim().replace(/\/+$/, '')
  const candidates = new Set<string>([trimmed])

  if (!trimmed.endsWith('.pmtiles')) {
    candidates.add(`${trimmed}.pmtiles`)
    if (sourceId === WORLD_SOURCE_ID) {
      candidates.add(`${trimmed}/world.pmtiles`)
      candidates.add(`${trimmed}/basemap.pmtiles`)
      candidates.add(`${trimmed}/protomaps.pmtiles`)
    } else if (sourceId === PARCELS_SOURCE_ID) {
      candidates.add(`${trimmed}/parcels.pmtiles`)
      candidates.add(`${trimmed}/parcels-temp.pmtiles`)
      candidates.add(`${trimmed}/us-parcels.pmtiles`)
    }
  }

  return [...candidates]
}

const ensureRasterFallbackBaseLayer = () => {
  const m = getMapInstance()
  if (!m) return

  const sourceId = 'fallback_osm_raster'
  const layerId = 'fallback_osm_raster_layer'

  if (!m.getSource(sourceId)) {
    m.addSource(sourceId, {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    })
  }

  if (!m.getLayer(layerId)) {
    m.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0.85,
      },
    })
  }
}

const parseVectorLayerNames = (metadata: unknown): string[] => {
  if (!metadata || typeof metadata !== 'object') return []

  const metaObj = metadata as Record<string, unknown>
  const vectorLayersRaw = metaObj.vector_layers

  const decode = (val: unknown): unknown => {
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
      try {
        return JSON.parse(val)
      } catch {
        return null
      }
    }
    return null
  }

  const decoded = decode(vectorLayersRaw)
  if (!Array.isArray(decoded)) return []

  return decoded
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const id = (entry as Record<string, unknown>).id
      return typeof id === 'string' ? id : null
    })
    .filter((id): id is string => !!id)
}

const parseBoundsFromMetadata = (metadata: unknown): [number, number, number, number] | null => {
  if (!metadata || typeof metadata !== 'object') return null

  const rawBounds = (metadata as Record<string, unknown>).bounds

  const toTuple = (arr: unknown[]): [number, number, number, number] | null => {
    if (arr.length < 4) return null
    const values = arr.slice(0, 4).map((v) => Number(v))
    if (values.some((v) => !Number.isFinite(v))) return null
    return [values[0]!, values[1]!, values[2]!, values[3]!]
  }

  if (Array.isArray(rawBounds)) return toTuple(rawBounds)

  if (typeof rawBounds === 'string') {
    const csv = rawBounds.split(',').map((v) => v.trim())
    return toTuple(csv)
  }

  return null
}

const parseBoundsFromHeader = (header: unknown): [number, number, number, number] | null => {
  if (!header || typeof header !== 'object') return null
  const h = header as Record<string, unknown>

  const minLon = Number(h.minLon)
  const minLat = Number(h.minLat)
  const maxLon = Number(h.maxLon)
  const maxLat = Number(h.maxLat)

  if (![minLon, minLat, maxLon, maxLat].every((v) => Number.isFinite(v))) return null
  if (minLon >= maxLon || minLat >= maxLat) return null

  return [minLon, minLat, maxLon, maxLat]
}

let resizeObserver: ResizeObserver | null = null

interface GenericMapProps {
  initialCenter?: [number, number]
  initialZoom?: number
  useDefaultTileLayer?: boolean
  mapStyle?: string | StyleSpecification
  tileLayerUrl?: string | undefined
  tileLayerOptions?: Record<string, unknown> | undefined
  placeName?: string | undefined
  worldPmtilesUrl?: string
  parcelsPmtilesUrl?: string
  showParcelsLayer?: boolean
  autoFitParcelsBounds?: boolean
  showNavigationControls?: boolean
}

const props = withDefaults(defineProps<GenericMapProps>(), {
  initialCenter: () => [0, 0],
  initialZoom: 10,
  useDefaultTileLayer: true,
  mapStyle: 'minimal',
  worldPmtilesUrl: WORLD_PM_URL,
  parcelsPmtilesUrl: PARCELS_PM_URL,
  showParcelsLayer: true,
  autoFitParcelsBounds: false,
  showNavigationControls: true,
})

const sidebarOpen = defineModel<boolean>('sidebarOpen', {
  default: false,
})

const emit = defineEmits([
  'ready',
  'moveend',
  'zoomend',
  'location-resolved',
  'geocode-error',
  'parcels-feature-click',
  'map-error',
])

const logPrefix = '[GenericMap]'
const mapEl = ref<HTMLDivElement | null>(null)
const map = ref<unknown>(null)
const mapInitError = ref<string | null>(null)
const slots = useSlots()
let resizeBurstTimers: ReturnType<typeof setTimeout>[] = []

const getMapInstance = (): maplibregl.Map | null => map.value as maplibregl.Map | null

const WORLD_SOURCE_ID = 'world_pmtiles'
const PARCELS_SOURCE_ID = 'parcels_pmtiles'
const STYLE_PRESET_URLS = {
  'dataviz-black': 'https://protomaps.github.io/basemaps-assets/styles/dataviz-black.json',
} as const

const isStyleSpecObject = (value: unknown): value is StyleSpecification => {
  return !!value && typeof value === 'object' && Number((value as StyleSpecification).version) === 8
}

const resolveMapStyle = (): StyleSpecification | string => {
  if (isStyleSpecObject(props.mapStyle)) return props.mapStyle
  if (props.mapStyle in STYLE_PRESET_URLS) {
    return STYLE_PRESET_URLS[props.mapStyle as keyof typeof STYLE_PRESET_URLS]
  }
  if (typeof props.mapStyle === 'string' && props.mapStyle !== 'minimal') return props.mapStyle
  return makeMinimalStyle()
}

const shouldAutoAddWorldBasemap = (): boolean => {
  if (!props.useDefaultTileLayer) return false
  return props.mapStyle === 'minimal'
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const hasWebGlSupport = (): boolean => {
  if (typeof document === 'undefined') return false

  const canvas = document.createElement('canvas')
  const gl =
    canvas.getContext('webgl2') ??
    canvas.getContext('webgl') ??
    canvas.getContext('experimental-webgl')

  return !!gl
}

const setupResizeObserver = () => {
  const m = getMapInstance()
  if (!mapEl.value || !m) return
  resizeObserver = new ResizeObserver(() => {
    m.resize()
  })
  resizeObserver.observe(mapEl.value)
}

const runResizeBurst = () => {
  resizeBurstTimers.forEach((t) => clearTimeout(t))
  resizeBurstTimers = []
  ;[0, 60, 180, 420, 900].forEach((delay) => {
    const timer = setTimeout(() => {
      getMapInstance()?.resize()
    }, delay)
    resizeBurstTimers.push(timer)
  })
}

const makeMinimalStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0e1116',
      },
    },
  ],
})

const addPmtilesVectorSourceWithAutoLayers = async (
  sourceId: string,
  url: string,
  options: {
    baseOpacity?: number
    lineColor?: string
    lineWidth?: number
    pointColor?: string
    beforeLayerId?: string
    addStreetLabels?: boolean
  } = {},
) => {
  const m = getMapInstance()
  if (!m || m.getSource(sourceId)) return

  let metadata: unknown = null
  let header: unknown = null
  let resolvedUrl = url
  let lastError: unknown = null

  const candidates = getPmtilesUrlCandidates(url, sourceId)
  for (const candidate of candidates) {
    try {
      const pmtiles = new PMTiles(createPmtilesOpfsSource(candidate))
      protocol.add(pmtiles)
      header = await pmtiles.getHeader()
      metadata = await pmtiles.getMetadata()
      resolvedUrl = candidate
      break
    } catch (error) {
      lastError = error
      console.warn(`${logPrefix} PMTiles candidate failed`, { sourceId, candidate, error })
    }
  }

  if (!metadata) {
    if (lastError instanceof Error) {
      throw lastError
    }
    throw new Error(`Failed to load PMTiles metadata for ${sourceId}`)
  }

  const sourceLayers = parseVectorLayerNames(metadata)
  const boundsFromMetadata = parseBoundsFromMetadata(metadata)
  const boundsFromHeader = parseBoundsFromHeader(header)
  const bounds = boundsFromMetadata ?? boundsFromHeader

  m.addSource(sourceId, {
    type: 'vector',
    url: `pmtiles://${resolvedUrl}`,
  })

  const insertBefore = options.beforeLayerId

  sourceLayers.forEach((sourceLayer, idx) => {
    const fillId = `${sourceId}_${sourceLayer}_fill`
    const lineId = `${sourceId}_${sourceLayer}_line`
    const pointId = `${sourceId}_${sourceLayer}_point`
    const layerColor =
      sourceId === WORLD_SOURCE_ID
        ? (['#3f4953', '#495662', '#55616c', '#606b75', '#6a7580', '#737f89'][idx % 6] ?? '#55616c')
        : (['#4cc9f0', '#f72585', '#90be6d', '#f9c74f', '#43aa8b', '#f9844a'][idx % 6] ?? '#4cc9f0')

    m.addLayer(
      {
        id: fillId,
        type: 'fill',
        source: sourceId,
        'source-layer': sourceLayer,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': layerColor,
          'fill-opacity': options.baseOpacity ?? (sourceId === WORLD_SOURCE_ID ? 0.04 : 0.08),
        },
      },
      insertBefore,
    )

    m.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        'source-layer': sourceLayer,
        paint: {
          'line-color': options.lineColor ?? '#93a1af',
          'line-width': options.lineWidth ?? 0.8,
          'line-opacity': sourceId === WORLD_SOURCE_ID ? 0.45 : 0.8,
        },
      },
      insertBefore,
    )

    m.addLayer(
      {
        id: pointId,
        type: 'circle',
        source: sourceId,
        'source-layer': sourceLayer,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': options.pointColor ?? '#e5e7eb',
          'circle-radius': 2,
          'circle-opacity': sourceId === WORLD_SOURCE_ID ? 0.35 : 0.8,
        },
      },
      insertBefore,
    )

    if (sourceId === PARCELS_SOURCE_ID) {
      ;[fillId, lineId, pointId].forEach((layerId) => {
        m.on('click', layerId, (e) => {
          const clicked = e.features?.[0]
          emit('parcels-feature-click', {
            layerId,
            sourceLayer,
            id: clicked?.id ?? null,
            properties: clicked?.properties ?? {},
            geometry: clicked?.geometry ?? null,
            lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
          })
        })
      })
    }
  })

  if (sourceId === WORLD_SOURCE_ID && options.addStreetLabels) {
    const roadLikeSourceLayers = sourceLayers.filter((layerName) =>
      /(road|street|transport|highway)/i.test(layerName),
    )

    roadLikeSourceLayers.forEach((sourceLayer) => {
      const layerId = `${sourceId}_${sourceLayer}_street_name`
      if (m.getLayer(layerId)) return

      m.addLayer(
        {
          id: layerId,
          type: 'symbol',
          source: sourceId,
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
        insertBefore,
      )
    })
  }

  console.log(`${logPrefix} added PMTiles source`, {
    sourceId,
    url: resolvedUrl,
    sourceLayerCount: sourceLayers.length,
    boundsFromMetadata,
    boundsFromHeader,
    bounds,
  })

  if (sourceId === PARCELS_SOURCE_ID && props.autoFitParcelsBounds && bounds) {
    m.fitBounds(
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

const bindMapEvents = () => {
  const m = getMapInstance()
  if (!m) return
  m.on('moveend', () => {
    const current = getMapInstance()
    if (current) emit('moveend', current)
  })
  m.on('zoomend', () => {
    const current = getMapInstance()
    if (current) emit('zoomend', current)
  })
}

const createMap = () => {
  if (!mapEl.value || getMapInstance()) return

  mapInitError.value = null

  if (!hasWebGlSupport()) {
    mapInitError.value = 'WebGL is not available in this browser session.'
    const error = new Error(mapInitError.value)
    console.error(`${logPrefix} map initialization blocked`, error)
    emit('map-error', { message: mapInitError.value, error })
    return
  }

  setupMapLibreWorker()
  setupPmtilesProtocol()

  try {
    map.value = new maplibregl.Map({
      container: mapEl.value,
      style: resolveMapStyle(),
      center: [props.initialCenter[1], props.initialCenter[0]],
      zoom: props.initialZoom,
      attributionControl: false,
    })
  } catch (error) {
    const message = getErrorMessage(error)
    mapInitError.value = `Failed to initialize WebGL map: ${message}`
    console.error(`${logPrefix} map initialization failed`, error)
    emit('map-error', { message: mapInitError.value, error })
    return
  }

  const m = getMapInstance()
  if (!m) return

  if (props.showNavigationControls) {
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
  }

  m.on('load', () => {
    void (async () => {
      try {
        if (shouldAutoAddWorldBasemap()) {
          await addPmtilesVectorSourceWithAutoLayers(WORLD_SOURCE_ID, props.worldPmtilesUrl, {
            baseOpacity: 0.035,
            lineColor: '#5f6973',
            lineWidth: 0.65,
            pointColor: '#7c8792',
            addStreetLabels: true,
          })
        }

        if (props.showParcelsLayer) {
          await addPmtilesVectorSourceWithAutoLayers(PARCELS_SOURCE_ID, props.parcelsPmtilesUrl, {
            baseOpacity: 0.14,
            lineColor: '#f97316',
            lineWidth: 1.3,
            pointColor: '#f97316',
          })
        }
      } catch (error) {
        console.error(`${logPrefix} PMTiles load error`, error)
        ensureRasterFallbackBaseLayer()
      }

      const current = getMapInstance()
      if (current) emit('ready', current)

      runResizeBurst()
    })()
  })

  bindMapEvents()
}

const destroyMap = () => {
  const m = getMapInstance()
  if (m) {
    m.remove()
    map.value = null
  }
}

const zoomTo = (lat: number, lng: number, zoom?: number) => {
  const m = getMapInstance()
  if (!m) return
  m.setCenter([lng, lat])
  if (typeof zoom === 'number') {
    m.setZoom(zoom)
  }
}

const setView = (lat: number, lng: number, zoom?: number) => {
  const m = getMapInstance()
  if (!m) return
  m.jumpTo({
    center: [lng, lat],
    zoom: typeof zoom === 'number' ? zoom : m.getZoom(),
  })
}

const getMap = (): maplibregl.Map | null => getMapInstance()

const geocodeAndZoom = async (
  placeName: string,
  options?: { zoom?: number },
): Promise<
  | { success: true; placeName: string; lat: number; lng: number; zoom: number }
  | { success: false; placeName: string; message: string }
> => {
  if (!placeName || !placeName.trim()) {
    const message = 'Empty place name'
    emit('geocode-error', { placeName, error: message })
    return { success: false, placeName, message }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}`
    const response = await fetch(url)
    const data = await response.json()

    if (!Array.isArray(data) || data.length === 0) {
      const message = `Place "${placeName}" not found`
      emit('geocode-error', { placeName, error: message })
      return { success: false, placeName, message }
    }

    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    const zoom = options?.zoom ?? props.initialZoom ?? 15

    const m = getMapInstance()
    if (m) {
      m.flyTo({ center: [lng, lat], zoom })
    }

    emit('location-resolved', { placeName, lat, lng, zoom })
    return { success: true, placeName, lat, lng, zoom }
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown error: ${String(error)}`
    emit('geocode-error', { placeName, error })
    return { success: false, placeName, message }
  }
}

const toggleSidebar = () => {
  if (!slots.sidebar) return
  sidebarOpen.value = !sidebarOpen.value
}

defineExpose({
  zoomTo,
  setView,
  geocodeAndZoom,
  getMap,
})

onMounted(() => {
  createMap()
  setupResizeObserver()
  runResizeBurst()
})

onBeforeUnmount(() => {
  resizeBurstTimers.forEach((t) => clearTimeout(t))
  resizeBurstTimers = []
  resizeObserver?.disconnect()
  destroyMap()
})
</script>

<style scoped>
.generic-map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 100px;
  min-height: 100px;
  --gm-sidebar-width: min(380px, 80%);
}

.generic-map-root {
  width: 100%;
  height: 100%;
}

.generic-map-error {
  position: absolute;
  inset: 0;
  z-index: 1050;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.25rem;
  background: #111827;
  color: #f9fafb;
  text-align: center;
}

.generic-map-error-title {
  font-size: 1rem;
  font-weight: 700;
}

.generic-map-error-body {
  max-width: 40rem;
  font-size: 0.875rem;
  line-height: 1.35;
  color: #d1d5db;
}

.generic-map-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--gm-sidebar-width);
  max-width: 90%;
  background: rgba(15, 15, 15, 0.96);
  color: #fff;
  overflow-y: auto;
  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.45);
  z-index: 1000;
  pointer-events: auto;
}

.generic-map-sidebar-enter-active,
.generic-map-sidebar-leave-active {
  transition:
    transform 0.25s ease-out,
    opacity 0.25s ease-out;
}

.generic-map-sidebar-enter-from,
.generic-map-sidebar-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.generic-map-sidebar-toggle {
  position: absolute;
  top: 50%;
  left: 0.5rem;
  transform: translateY(-50%);
  z-index: 1100;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.generic-map-sidebar-toggle:hover {
  background: rgba(0, 0, 0, 0.8);
}

.generic-map-wrapper.sidebar-open .generic-map-sidebar-toggle {
  left: var(--gm-sidebar-width);
}
</style>
