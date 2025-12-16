<!-- src/components/GenericMap.vue -->
<template>
  <div class="generic-map-wrapper" :class="{ 'sidebar-open': !!$slots.sidebar && sidebarOpen }">
    <!-- Actual Leaflet map container -->
    <div ref="mapEl" class="generic-map-root" />

    <!-- Toggle button (only shown if a sidebar slot is provided) -->
    <button
      v-if="$slots.sidebar"
      type="button"
      class="generic-map-sidebar-toggle"
      @click="toggleSidebar"
    >
      <span v-if="sidebarOpen">⟨</span>
      <span v-else>⟩</span>
    </button>

    <!-- Left overlay panel -->
    <transition name="generic-map-sidebar">
      <div v-if="$slots.sidebar && sidebarOpen" class="generic-map-sidebar">
        <slot name="sidebar" />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import L from 'leaflet'
import 'leaflet.vectorgrid'
import { onBeforeUnmount, onMounted, ref, useSlots } from 'vue'

let resizeObserver: ResizeObserver | null = null

const setupResizeObserver = () => {
  if (!mapEl.value || !map.value) return

  resizeObserver = new ResizeObserver(() => {
    map.value?.invalidateSize()
  })
  resizeObserver.observe(mapEl.value)
}

// Polyfill for Leaflet >= 1.9 + leaflet.vectorgrid
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DomEventAny = L.DomEvent as any

if (!DomEventAny.fakeStop) {
  DomEventAny.fakeStop = (e: Event) => {
    // Mark the event as "skipped" so Leaflet ignores it for map click/drag.
    // This is what old fakeStop essentially did.
    if (typeof DomEventAny._skipped === 'function') {
      DomEventAny._skipped(e)
    }
  }
}

interface GenericMapProps {
  initialCenter: [number, number]
  initialZoom: number
  useDefaultTileLayer: boolean
  // eslint-disable-next-line vue/require-default-prop
  tileLayerUrl?: string
  // eslint-disable-next-line vue/require-default-prop
  tileLayerOptions?: L.TileLayerOptions
  // eslint-disable-next-line vue/require-default-prop
  placeName?: string
}

const props = withDefaults(defineProps<GenericMapProps>(), {
  initialCenter: () => [0, 0],
  initialZoom: 10,
  useDefaultTileLayer: true,
})

const sidebarOpen = defineModel<boolean>('sidebarOpen', {
  default: false,
})

const logPrefix = '[GenericMap]'
let mountAt = performance.now()

const emit = defineEmits<{
  (e: 'ready', map: L.Map): void
  (e: 'moveend', map: L.Map): void
  (e: 'zoomend', map: L.Map): void
  (
    e: 'location-resolved',
    payload: {
      placeName: string
      lat: number
      lng: number
      zoom: number
    },
  ): void
  (e: 'geocode-error', payload: { placeName: string; error: unknown }): void
}>()

const mapEl = ref<HTMLDivElement | null>(null)
const map = ref<L.Map | null>(null)
let tileLayer: L.TileLayer | null = null
const slots = useSlots()

const toggleSidebar = () => {
  if (!slots.sidebar) return
  sidebarOpen.value = !sidebarOpen.value
}

const createMap = () => {
  console.log(`${logPrefix} createMap() start`, {
    hasEl: !!mapEl.value,
    hasMap: !!map.value,
    props,
  })
  if (!mapEl.value) return
  if (map.value) return

  map.value = L.map(mapEl.value, {
    center: props.initialCenter,
    zoom: props.initialZoom,
    zoomControl: false,
    // TODO: enable this, it mght make it much better :)
    // right now, it simply causes skewed layers??
    // probably due to resizing of the map after initializaton
    preferCanvas: false, // makes it much more performant...
  })

  console.log(`${logPrefix} map created`, { center: props.initialCenter, zoom: props.initialZoom })

  if (props.useDefaultTileLayer) {
    const tileUrl =
      props.tileLayerUrl ?? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

    const tileOptions: L.TileLayerOptions = {
      attribution: '',
      maxZoom: 19,
      ...(props.tileLayerOptions ?? {}),
    }

    tileLayer = L.tileLayer(tileUrl, tileOptions).addTo(map.value as L.Map)
    console.log(`${logPrefix} tileLayer added`, { tileUrl, tileOptions })
  }

  map.value.on('moveend', () => {
    if (map.value) {
      console.log(`${logPrefix} moveend`, {
        center: map.value.getCenter(),
        zoom: map.value.getZoom(),
      })
      emit('moveend', map.value as L.Map)
    }
  })

  map.value.on('zoomend', () => {
    if (map.value) {
      console.log(`${logPrefix} zoomend`, {
        center: map.value.getCenter(),
        zoom: map.value.getZoom(),
      })
      emit('zoomend', map.value as L.Map)
    }
  })

  emit('ready', map.value as L.Map)
  console.log(`${logPrefix} emitted 'ready'`)

  setTimeout(() => {
    map.value?.invalidateSize()
    console.log(`${logPrefix} invalidateSize() after timeout`)
  }, 50)
}

const destroyMap = () => {
  console.log(`${logPrefix} destroyMap()`, { hasTile: !!tileLayer, hasMap: !!map.value })
  if (tileLayer) {
    tileLayer.remove()
    tileLayer = null
  }

  if (map.value) {
    map.value.off()
    map.value.remove()
    map.value = null
  }
}

// Imperative API

const zoomTo = (lat: number, lng: number, zoom?: number) => {
  console.log(`${logPrefix} zoomTo()`, { lat, lng, zoom, hasMap: !!map.value })
  if (!map.value) return
  const targetZoom = zoom ?? map.value.getZoom()
  map.value.setView([lat, lng], targetZoom)
}

const setView = (lat: number, lng: number, zoom?: number) => {
  console.log(`${logPrefix} setView()`, { lat, lng, zoom })
  zoomTo(lat, lng, zoom)
}

const getMap = () => map.value

/**
 * Geocode a place name via Nominatim and zoom the map to the result.
 * Call this from the parent when the user has finished entering a location.
 */
const geocodeAndZoom = async (
  placeName: string,
  options?: { zoom?: number },
): Promise<
  | { success: true; placeName: string; lat: number; lng: number; zoom: number }
  | { success: false; placeName: string; message: string }
> => {
  console.log(`${logPrefix} geocodeAndZoom() start`, { placeName, options })
  if (!placeName || !placeName.trim()) {
    const message = 'Empty place name'
    emit('geocode-error', { placeName, error: message })
    console.warn(`${logPrefix} geocodeAndZoom(): ${message}`)
    return { success: false, placeName, message }
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}`
    console.log(`${logPrefix} fetch`, { url })
    const t0 = performance.now()
    const response = await fetch(url)
    const data = await response.json()
    console.log(`${logPrefix} fetch result`, {
      durationMs: Math.round(performance.now() - t0),
      dataSample: Array.isArray(data) ? data.slice(0, 1) : data,
    })

    if (!Array.isArray(data) || data.length === 0) {
      const message = `Place "${placeName}" not found`
      emit('geocode-error', { placeName, error: message })
      console.warn(`${logPrefix} geocodeAndZoom(): ${message}`)
      return { success: false, placeName, message }
    }

    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    const zoom = options?.zoom ?? props.initialZoom ?? 15

    if (map.value) {
      map.value.setView([lat, lng], zoom)
      console.log(`${logPrefix} setView after geocode`, { lat, lng, zoom })
    } else {
      console.warn(`${logPrefix} map not ready during geocode setView`)
    }

    emit('location-resolved', { placeName, lat, lng, zoom })
    console.log(`${logPrefix} emitted 'location-resolved'`, { placeName, lat, lng, zoom })

    return { success: true, placeName, lat, lng, zoom }
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown error: ${String(error)}`
    emit('geocode-error', { placeName, error })
    console.error(`${logPrefix} geocodeAndZoom error`, { placeName, error })
    return { success: false, placeName, message }
  }
}

defineExpose({
  zoomTo,
  setView,
  geocodeAndZoom,
  getMap,
})

onMounted(() => {
  mountAt = performance.now()
  console.log(`${logPrefix} mounted`, { mountAt, props })
  createMap()
  setupResizeObserver()
})

onBeforeUnmount(() => {
  console.log(`${logPrefix} beforeUnmount`, { lifeMs: Math.round(performance.now() - mountAt) })
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

  /* Share sidebar width as a CSS variable for consistent positioning */
  --gm-sidebar-width: min(380px, 80%);
}

/* Leaflet map container must fill the wrapper */
.generic-map-root {
  width: 100%;
  height: 100%;
}

/* Sidebar overlay on top of the map */
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

  /* Ensure it sits above Leaflet layers/controls */
  z-index: 1000;

  pointer-events: auto;
}

/* Slide-in transition for the sidebar */
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

/* Small toggle button */
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

/* When sidebar is open, move the toggle to the sidebar's right edge */
.generic-map-wrapper.sidebar-open .generic-map-sidebar-toggle {
  left: var(--gm-sidebar-width);
}
</style>
