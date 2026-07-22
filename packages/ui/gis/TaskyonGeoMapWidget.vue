<template>
  <div class="taskyon-geo-map-widget">
    <GenericMap
      ref="mapRef"
      v-model:sidebar-open="sidebarOpen"
      class="taskyon-geo-map-widget__map"
      :initial-center="initialCenter"
      :initial-zoom="initialZoom"
      :show-parcels-layer="false"
      :auto-fit-parcels-bounds="false"
      @ready="handleMapReady"
    >
      <template #sidebar>
        <div class="taskyon-geo-map-widget__sidebar">
          <div class="taskyon-geo-map-widget__title">{{ state.title || 'Map results' }}</div>
          <div class="taskyon-geo-map-widget__query">{{ state.query }}</div>
          <button
            v-for="location in state.locations"
            :key="`${location.name}-${location.lat}-${location.lng}`"
            type="button"
            class="taskyon-geo-map-widget__result"
            @click="focusLocation(location)"
          >
            {{ location.name }}
          </button>
        </div>
      </template>
    </GenericMap>
  </div>
</template>

<script setup lang="ts">
import type { FeatureCollection, Geometry } from 'geojson'
import GenericMap from '../components/GenericMap.vue'
import type { MapSearchLocation, TaskyonMapWidgetState } from './taskyonMapWidget'
import maplibregl from 'maplibre-gl'
import type { FilterSpecification } from 'maplibre-gl'
import { computed, onBeforeUnmount, ref } from 'vue'

interface GenericMapExpose {
  setView: (lat: number, lng: number, zoom?: number) => void
}

const GEOJSON_SOURCE_ID = 'taskyon_geojson_source'
const GEOJSON_FILL_LAYER_ID = 'taskyon_geojson_fill'
const GEOJSON_LINE_LAYER_ID = 'taskyon_geojson_line'
const GEOJSON_POINT_LAYER_ID = 'taskyon_geojson_point'

const props = defineProps<{
  state: TaskyonMapWidgetState
}>()

const mapRef = ref<GenericMapExpose | null>(null)
const sidebarOpen = ref(true)
let markers: maplibregl.Marker[] = []

const firstLocation = computed(() => props.state.locations[0] ?? null)
const initialCenter = computed<[number, number]>(() => {
  const location = firstLocation.value
  return location ? [location.lat, location.lng] : [0, 0]
})
const initialZoom = computed(() => (props.state.locations.length > 1 ? 4 : 11))

const clearMarkers = () => {
  markers.forEach((marker) => marker.remove())
  markers = []
}

const createMarkerElement = (index: number) => {
  const marker = document.createElement('div')
  marker.className = 'maplibregl-marker taskyon-geo-map-widget__marker'
  marker.textContent = String(index + 1)
  return marker
}

const addMarkers = (map: maplibregl.Map) => {
  clearMarkers()
  markers = props.state.locations.map((location, index) =>
    new maplibregl.Marker({ element: createMarkerElement(index) })
      .setLngLat([location.lng, location.lat])
      .addTo(map),
  )
}

const toLngLat = (coordinates: readonly number[]): [number, number] | null => {
  const [lng, lat] = coordinates
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  return [lng, lat]
}

const flattenGeometryCoordinates = (geometry: Geometry): [number, number][] => {
  switch (geometry.type) {
    case 'Point': {
      const coordinate = toLngLat(geometry.coordinates)
      return coordinate ? [coordinate] : []
    }
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates.flatMap((entry) => {
        const coordinate = toLngLat(entry)
        return coordinate ? [coordinate] : []
      })
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates.flat().flatMap((entry) => {
        const coordinate = toLngLat(entry)
        return coordinate ? [coordinate] : []
      })
    case 'MultiPolygon':
      return geometry.coordinates.flat(2).flatMap((entry) => {
        const coordinate = toLngLat(entry)
        return coordinate ? [coordinate] : []
      })
    case 'GeometryCollection':
      return geometry.geometries.flatMap(flattenGeometryCoordinates)
  }
}

const collectFeatureBounds = (featureCollection: FeatureCollection) => {
  const coordinates = featureCollection.features.flatMap((feature) =>
    flattenGeometryCoordinates(feature.geometry),
  )
  if (coordinates.length === 0) return null

  const first = coordinates[0]
  if (!first) return null

  return coordinates.reduce(
    (acc, [lng, lat]) => ({
      minLng: Math.min(acc.minLng, lng),
      minLat: Math.min(acc.minLat, lat),
      maxLng: Math.max(acc.maxLng, lng),
      maxLat: Math.max(acc.maxLat, lat),
    }),
    {
      minLng: first[0],
      minLat: first[1],
      maxLng: first[0],
      maxLat: first[1],
    },
  )
}

const removeGeoJsonLayers = (map: maplibregl.Map) => {
  ;[GEOJSON_POINT_LAYER_ID, GEOJSON_LINE_LAYER_ID, GEOJSON_FILL_LAYER_ID].forEach((layerId) => {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  })
  if (map.getSource(GEOJSON_SOURCE_ID)) map.removeSource(GEOJSON_SOURCE_ID)
}

const getFeatureLabel = (feature: maplibregl.MapGeoJSONFeature) => {
  const name = feature.properties?.['name']
  return typeof name === 'string' && name.trim() ? name : 'Map feature'
}

const addGeoJsonPopup = (map: maplibregl.Map, layerId: string) => {
  map.on('click', layerId, (event) => {
    const feature = event.features?.[0]
    if (!feature) return

    new maplibregl.Popup({ closeButton: true })
      .setLngLat(event.lngLat)
      .setHTML(`<div>${getFeatureLabel(feature)}</div>`)
      .addTo(map)
  })
}

const polygonFilter: FilterSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
]
const lineFilter: FilterSpecification = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
  true,
  false,
]
const pointFilter: FilterSpecification = [
  'match',
  ['geometry-type'],
  ['Point', 'MultiPoint'],
  true,
  false,
]

const addGeoJsonOverlay = (map: maplibregl.Map, featureCollection: FeatureCollection) => {
  removeGeoJsonLayers(map)

  map.addSource(GEOJSON_SOURCE_ID, {
    type: 'geojson',
    data: featureCollection,
  })

  map.addLayer({
    id: GEOJSON_FILL_LAYER_ID,
    type: 'fill',
    source: GEOJSON_SOURCE_ID,
    filter: polygonFilter,
    paint: {
      'fill-color': '#38bdf8',
      'fill-opacity': 0.18,
    },
  })

  map.addLayer({
    id: GEOJSON_LINE_LAYER_ID,
    type: 'line',
    source: GEOJSON_SOURCE_ID,
    filter: lineFilter,
    paint: {
      'line-color': '#0ea5e9',
      'line-width': 2,
    },
  })

  map.addLayer({
    id: GEOJSON_POINT_LAYER_ID,
    type: 'circle',
    source: GEOJSON_SOURCE_ID,
    filter: pointFilter,
    paint: {
      'circle-color': '#f97316',
      'circle-radius': 5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  })

  addGeoJsonPopup(map, GEOJSON_FILL_LAYER_ID)
  addGeoJsonPopup(map, GEOJSON_LINE_LAYER_ID)
  addGeoJsonPopup(map, GEOJSON_POINT_LAYER_ID)
}

const fitMapData = (map: maplibregl.Map) => {
  if (props.state.featureCollection) {
    const bounds = collectFeatureBounds(props.state.featureCollection)
    if (bounds) {
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: 48,
          maxZoom: 12,
          duration: 0,
        },
      )
      return
    }
  }

  if (props.state.locations.length === 1) {
    const location = props.state.locations[0]
    if (location) map.flyTo({ center: [location.lng, location.lat], zoom: 11 })
    return
  }

  if (props.state.locations.length > 1) {
    const first = props.state.locations[0]
    if (!first) return
    const bounds = props.state.locations.reduce(
      (acc, location) => acc.extend([location.lng, location.lat]),
      new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]),
    )

    map.fitBounds(bounds, {
      padding: 48,
      maxZoom: 11,
      duration: 0,
    })
  }
}

const handleMapReady = (map: maplibregl.Map) => {
  addMarkers(map)
  if (props.state.featureCollection) {
    addGeoJsonOverlay(map, props.state.featureCollection)
  }
  fitMapData(map)
}

const focusLocation = (location: MapSearchLocation) => {
  mapRef.value?.setView(location.lat, location.lng, 13)
}

onBeforeUnmount(() => {
  clearMarkers()
})
</script>

<style scoped>
.taskyon-geo-map-widget {
  width: 100%;
  height: 100%;
  min-height: 32rem;
}

.taskyon-geo-map-widget__map {
  width: 100%;
  height: 100%;
}

.taskyon-geo-map-widget__sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
}

.taskyon-geo-map-widget__title {
  font-size: 0.95rem;
  font-weight: 700;
}

.taskyon-geo-map-widget__query {
  font-size: 0.8rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.78);
}

.taskyon-geo-map-widget__result {
  display: block;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.taskyon-geo-map-widget__result:hover {
  background: rgba(255, 255, 255, 0.1);
}

:global(.taskyon-geo-map-widget__marker) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #f97316;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.35);
}
</style>
