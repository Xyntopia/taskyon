<template>
  <div class="taskyon-map">
    <div ref="mapElement" class="taskyon-map__canvas" />
    <div v-if="errorMessage" class="taskyon-map__error" role="status">
      <strong>Map unavailable</strong>
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import type { GeoJSON } from 'geojson'
import type { LayerSpecification } from 'maplibre-gl'

export interface TaskyonGeoJsonOverlay {
  readonly id: string
  readonly data: GeoJSON
  readonly layers: readonly LayerSpecification[]
}
</script>

<script setup lang="ts">
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  addPmtilesVectorLayer,
  defaultWorldPmtilesUrl,
  type PmtilesSourceFactory,
  type TaskyonPmtilesRuntime,
} from './pmtiles'

const props = withDefaults(
  defineProps<{
    overlays?: readonly TaskyonGeoJsonOverlay[]
    runtime: TaskyonPmtilesRuntime
    sourceFactory?: PmtilesSourceFactory
    pmtilesUrl?: string
    center?: readonly [number, number]
    zoom?: number
    theme?: 'light' | 'dark'
    showNavigationControls?: boolean
  }>(),
  {
    overlays: () => [],
    pmtilesUrl: defaultWorldPmtilesUrl,
    center: () => [0, 0],
    zoom: 2,
    theme: 'dark',
    showNavigationControls: true,
  },
)

const emit = defineEmits<{
  ready: [map: maplibregl.Map]
  error: [error: unknown]
}>()

const mapElement = ref<HTMLDivElement | null>(null)
const errorMessage = ref<string | null>(null)
const runtime = props.runtime
const overlayLayerIds = new Set<string>()
const overlaySourceIds = new Set<string>()
let map: maplibregl.Map | null = null

const mapStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': props.theme === 'dark' ? '#0e1116' : '#edf1f4',
      },
    },
  ],
})

const removeMissingOverlays = (target: maplibregl.Map): void => {
  const desiredLayers = new Set(
    props.overlays.flatMap((overlay) => overlay.layers.map(({ id }) => id)),
  )
  const desiredSources = new Set(props.overlays.map(({ id }) => id))
  overlayLayerIds.forEach((id) => {
    if (!desiredLayers.has(id) && target.getLayer(id)) target.removeLayer(id)
    if (!desiredLayers.has(id)) overlayLayerIds.delete(id)
  })
  overlaySourceIds.forEach((id) => {
    if (!desiredSources.has(id) && target.getSource(id)) target.removeSource(id)
    if (!desiredSources.has(id)) overlaySourceIds.delete(id)
  })
}

const syncOverlays = (): void => {
  if (!map?.isStyleLoaded()) return
  removeMissingOverlays(map)
  props.overlays.forEach((overlay) => {
    const source = map?.getSource(overlay.id)
    if (source) {
      ;(source as GeoJSONSource).setData(overlay.data)
    } else {
      map?.addSource(overlay.id, { type: 'geojson', data: overlay.data })
      overlaySourceIds.add(overlay.id)
    }
    overlay.layers.forEach((layer) => {
      if ('source' in layer && layer.source !== overlay.id) {
        throw new Error(`Overlay layer ${layer.id} must use source ${overlay.id}.`)
      }
      if (!map?.getLayer(layer.id)) {
        map?.addLayer(layer)
        overlayLayerIds.add(layer.id)
      }
    })
  })
}

const initializeMap = (): void => {
  if (!mapElement.value || map) return
  errorMessage.value = null
  try {
    runtime.setup()
    map = new maplibregl.Map({
      container: mapElement.value,
      style: mapStyle(),
      center: [...props.center],
      zoom: props.zoom,
      attributionControl: false,
    })
    if (props.showNavigationControls) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    }
    map.on('load', () => {
      void (async () => {
        if (!map) return
        try {
          await addPmtilesVectorLayer(
            runtime,
            map,
            {
              id: 'taskyon_world',
              url: props.pmtilesUrl,
              baseOpacity: props.theme === 'dark' ? 0.045 : 0.08,
              lineColor: props.theme === 'dark' ? '#697682' : '#8b969f',
              lineWidth: 0.65,
              pointColor: props.theme === 'dark' ? '#88949f' : '#66727c',
            },
            props.sourceFactory,
          )
        } catch (error) {
          errorMessage.value = 'The basemap data could not be loaded.'
          emit('error', error)
        }
        syncOverlays()
        emit('ready', map)
      })()
    })
  } catch (error) {
    errorMessage.value = 'This browser could not initialize the map.'
    emit('error', error)
  }
}

watch(() => props.overlays, syncOverlays, { deep: true })
watch(
  () => props.theme,
  (theme) =>
    map?.setPaintProperty(
      'background',
      'background-color',
      theme === 'dark' ? '#0e1116' : '#edf1f4',
    ),
)

onMounted(initializeMap)

onBeforeUnmount(() => {
  map?.remove()
  map = null
  runtime.dispose()
})
</script>

<style scoped>
.taskyon-map {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 10rem;
  min-height: 10rem;
}

.taskyon-map__canvas {
  width: 100%;
  height: 100%;
}

.taskyon-map__error {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 0.35rem;
  padding: 1.5rem;
  background: color-mix(in srgb, Canvas 94%, transparent);
  color: CanvasText;
  text-align: center;
}

.taskyon-map__error span {
  opacity: 0.72;
}
</style>
