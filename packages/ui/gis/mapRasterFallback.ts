import type { Map as MapLibreMap } from 'maplibre-gl'

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
      paint: { 'raster-opacity': 0.85 },
    })
  }
}
