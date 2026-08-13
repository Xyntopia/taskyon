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
import {
  addPmtilesVectorLayer,
  addRasterFallbackBaseLayer,
  defaultWorldPmtilesUrl,
  setupTaskyonMapLibreWorker,
  setupTaskyonPmtilesProtocol,
  type TaskyonPmtilesVectorLayerSpec,
} from '../gis/maplibrePmtiles'
import { onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'

const PARCELS_PM_URL =
  'https://eu2.contabostorage.com/af09f5440e00407ca6d2d275a4a4dc89:parcels-temp/parcels.pmtiles'

let resizeObserver: ResizeObserver | null = null

interface GenericMapProps {
  storageClient?: TaskyonStorageClient
  initialCenter?: [number, number]
  initialZoom?: number
  useDefaultTileLayer?: boolean
  mapStyle?: string | StyleSpecification
  tileLayerUrl?: string
  tileLayerOptions?: Record<string, unknown>
  placeName?: string
  worldPmtilesUrl?: string
  parcelsPmtilesUrl?: string
  showParcelsLayer?: boolean
  autoFitParcelsBounds?: boolean
  pmtilesVectorLayers?: TaskyonPmtilesVectorLayerSpec[]
  showNavigationControls?: boolean
}

const props = withDefaults(defineProps<GenericMapProps>(), {
  initialCenter: () => [0, 0],
  initialZoom: 10,
  useDefaultTileLayer: true,
  mapStyle: 'minimal',
  worldPmtilesUrl: defaultWorldPmtilesUrl,
  parcelsPmtilesUrl: PARCELS_PM_URL,
  showParcelsLayer: false,
  autoFitParcelsBounds: false,
  pmtilesVectorLayers: () => [],
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

const getDefaultPmtilesLayers = (): TaskyonPmtilesVectorLayerSpec[] => {
  const layers: TaskyonPmtilesVectorLayerSpec[] = []

  if (shouldAutoAddWorldBasemap()) {
    layers.push({
      id: WORLD_SOURCE_ID,
      url: props.worldPmtilesUrl,
      suffixes: ['world.pmtiles', 'basemap.pmtiles', 'protomaps.pmtiles'],
      baseOpacity: 0.035,
      lineColor: '#5f6973',
      lineWidth: 0.65,
      pointColor: '#7c8792',
      addStreetLabels: true,
    })
  }

  if (props.showParcelsLayer) {
    layers.push({
      id: PARCELS_SOURCE_ID,
      url: props.parcelsPmtilesUrl,
      suffixes: ['parcels.pmtiles', 'parcels-temp.pmtiles', 'us-parcels.pmtiles'],
      baseOpacity: 0.14,
      lineColor: '#f97316',
      lineWidth: 1.3,
      lineOpacity: 0.8,
      pointColor: '#f97316',
      pointOpacity: 0.8,
      autoFitBounds: props.autoFitParcelsBounds,
      colorPalette: ['#4cc9f0', '#f72585', '#90be6d', '#f9c74f', '#43aa8b', '#f9844a'],
      onFeatureClick: (payload) => emit('parcels-feature-click', payload),
    })
  }

  return layers
}

const addConfiguredPmtilesLayers = async () => {
  const m = getMapInstance()
  if (!m) return
  const layers = [...getDefaultPmtilesLayers(), ...props.pmtilesVectorLayers]
  for (const layer of layers) {
    await addPmtilesVectorLayer(m, layer, props.storageClient)
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

  setupTaskyonMapLibreWorker()
  setupTaskyonPmtilesProtocol()

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
      const current = getMapInstance()
      if (!current) return

      try {
        await addConfiguredPmtilesLayers()
      } catch (error) {
        console.error(`${logPrefix} PMTiles load error`, error)
        addRasterFallbackBaseLayer(current)
      }

      emit('ready', current)

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
