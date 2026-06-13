import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { defaultWorldPmtilesUrl } from './mapSources'

export interface MapSearchLocation {
  name: string
  lat: number
  lng: number
}

export interface TaskyonMapWidgetState {
  mode: 'locations' | 'geojson'
  query: string
  title?: string
  locations: MapSearchLocation[]
  featureCollection?: FeatureCollection
}

export const taskyonMapWidgetRoutePath = '/map-widget'

const escapeHtmlAttr = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isStringOrUndefined = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const toLocation = (value: unknown): MapSearchLocation | null => {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string') return null
  if (!isFiniteNumber(raw.lat) || !isFiniteNumber(raw.lng)) return null

  return {
    name: raw.name,
    lat: raw.lat,
    lng: raw.lng,
  }
}

const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])

const isLinearRing = (value: unknown): value is [number, number][] =>
  Array.isArray(value) && value.every(isPosition)

const isPolygonCoords = (value: unknown): value is [number, number][][] =>
  Array.isArray(value) && value.every(isLinearRing)

const isMultiPolygonCoords = (value: unknown): value is [number, number][][][] =>
  Array.isArray(value) && value.every(isPolygonCoords)

const isLineStringCoords = (value: unknown): value is [number, number][] =>
  Array.isArray(value) && value.every(isPosition)

const isMultiLineStringCoords = (value: unknown): value is [number, number][][] =>
  Array.isArray(value) && value.every(isLineStringCoords)

const isMultiPointCoords = (value: unknown): value is [number, number][] =>
  Array.isArray(value) && value.every(isPosition)

const isGeoJsonGeometry = (value: unknown): value is Geometry => {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'Point':
      return isPosition(raw.coordinates)
    case 'MultiPoint':
      return isMultiPointCoords(raw.coordinates)
    case 'LineString':
      return isLineStringCoords(raw.coordinates)
    case 'MultiLineString':
      return isMultiLineStringCoords(raw.coordinates)
    case 'Polygon':
      return isPolygonCoords(raw.coordinates)
    case 'MultiPolygon':
      return isMultiPolygonCoords(raw.coordinates)
    default:
      return false
  }
}

const toFeature = (value: unknown): Feature | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'Feature' || !isGeoJsonGeometry(raw.geometry)) return null
  return {
    type: 'Feature',
    geometry: raw.geometry,
    properties:
      raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties)
        ? (raw.properties as Record<string, unknown>)
        : {},
    ...(raw.id !== undefined ? { id: raw.id as string | number } : {}),
  }
}

const toFeatureCollection = (value: unknown): FeatureCollection | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) return null
  const features = raw.features.map(toFeature).filter((entry): entry is Feature => !!entry)
  if (features.length === 0) return null
  return {
    type: 'FeatureCollection',
    features,
  }
}

export const parseTaskyonMapWidgetState = (value: unknown): TaskyonMapWidgetState | null => {
  if (!value || typeof value !== 'object') return null

  const parsed = value as Record<string, unknown>
  if (
    (parsed.mode !== 'locations' && parsed.mode !== 'geojson') ||
    typeof parsed.query !== 'string'
  )
    return null
  if (!Array.isArray(parsed.locations)) return null
  if (!isStringOrUndefined(parsed.title)) return null

  const locations = parsed.locations
    .map(toLocation)
    .filter((entry): entry is MapSearchLocation => !!entry)
  const featureCollection =
    parsed.featureCollection === undefined
      ? undefined
      : toFeatureCollection(parsed.featureCollection)

  if (parsed.mode === 'locations' && locations.length === 0) return null
  if (parsed.mode === 'geojson' && !featureCollection) return null

  return {
    mode: parsed.mode,
    query: parsed.query,
    ...(parsed.title ? { title: parsed.title } : {}),
    locations,
    ...(featureCollection ? { featureCollection } : {}),
  }
}

export const decodeTaskyonMapWidgetState = (
  encoded: string | undefined,
): TaskyonMapWidgetState | null => {
  if (!encoded) return null

  try {
    return parseTaskyonMapWidgetState(JSON.parse(decodeURIComponent(encoded)))
  } catch {
    return null
  }
}

export const buildTaskyonMapWidgetUrl = (origin: string) =>
  new URL(taskyonMapWidgetRoutePath, origin).toString()

export const buildTaskyonMapWidgetDebugUrl = (origin: string, state: TaskyonMapWidgetState) => {
  const url = new URL(taskyonMapWidgetRoutePath, origin)
  url.searchParams.set('state', encodeURIComponent(JSON.stringify(state)))
  return url.toString()
}

const escapeScriptJson = (value: unknown) =>
  JSON.stringify(value).replaceAll('</script>', '<\\/script>')

export const buildStandaloneTaskyonMapWidgetHtml = (state: TaskyonMapWidgetState) => {
  const title = escapeHtmlAttr(state.title ?? 'Map results')
  const serializedState = escapeScriptJson(state)
  const serializedPmtilesUrl = escapeScriptJson(defaultWorldPmtilesUrl)

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.css" />
    <style>
      html, body, #map { width: 100%; min-height: 32rem; margin: 0; }
      #map { height: max(32rem, 100vh); }
      html, body { background: transparent; }
      body {
        color: inherit;
        font-family: system-ui, sans-serif;
        color-scheme: light dark;
      }
      .sidebar {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        width: min(24rem, 42vw);
        max-height: 100%;
        overflow: auto;
        box-sizing: border-box;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.88);
        color: #1f2937;
        backdrop-filter: blur(8px);
        box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.16);
      }
      .title { font-weight: 700; margin-bottom: 0.6rem; }
      .query { color: rgba(31, 41, 55, 0.72); font-size: 0.82rem; line-height: 1.35; }
      .result {
        margin-top: 0.55rem;
        padding: 0.6rem 0.7rem;
        border: 1px solid rgba(31, 41, 55, 0.14);
        border-radius: 0.45rem;
        background: rgba(255, 255, 255, 0.56);
      }
      .marker {
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
      .maplibregl-ctrl-attrib {
        background: rgba(255, 255, 255, 0.72);
      }
      body[data-taskyon-theme="dark"] .sidebar {
        background: rgba(15, 23, 42, 0.82);
        color: #f8fafc;
        box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.28);
      }
      body[data-taskyon-theme="dark"] .query { color: rgba(248, 250, 252, 0.74); }
      body[data-taskyon-theme="dark"] .result {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
      }
      body[data-taskyon-theme="dark"] .maplibregl-ctrl-attrib {
        background: rgba(15, 23, 42, 0.72);
        color: #f8fafc;
      }
      @media (prefers-color-scheme: dark) {
        body { color: #f8fafc; }
        .sidebar {
          background: rgba(15, 23, 42, 0.82);
          color: #f8fafc;
          box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.28);
        }
        .query { color: rgba(248, 250, 252, 0.74); }
        .result {
          border-color: rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.05);
        }
        .maplibregl-ctrl-attrib {
          background: rgba(15, 23, 42, 0.72);
          color: #f8fafc;
        }
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <aside class="sidebar">
      <div class="title"></div>
      <div class="query"></div>
      <div class="results"></div>
    </aside>
    <script type="module">
      import maplibregl from 'https://esm.sh/maplibre-gl@5.13.0'
      import { Protocol, PMTiles } from 'https://esm.sh/pmtiles@4.3.0'

      const state = ${serializedState}
      const pmtilesUrl = ${serializedPmtilesUrl}
      const pageTheme = document.body.dataset.taskyonTheme
      const prefersDark =
        pageTheme === 'dark' ||
        (pageTheme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true)
      const theme = prefersDark
        ? {
            background: 'rgba(15, 23, 42, 0.08)',
            fill: '#334155',
            line: '#94a3b8',
            point: '#cbd5e1',
            resultLine: '#0ea5e9',
          }
        : {
            background: 'rgba(255, 255, 255, 0.12)',
            fill: '#d8e2ef',
            line: '#64748b',
            point: '#475569',
            resultLine: '#0284c7',
          }
      const protocol = new Protocol()
      maplibregl.addProtocol('pmtiles', protocol.tile)

      document.querySelector('.title').textContent = state.title || 'Map results'
      document.querySelector('.query').textContent = state.query || ''
      const results = document.querySelector('.results')
      for (const location of state.locations || []) {
        const row = document.createElement('div')
        row.className = 'result'
        row.textContent = location.name
        results.append(row)
      }

      const map = new maplibregl.Map({
        container: 'map',
        style: {
          version: 8,
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
          sources: {},
          layers: [
            {
              id: 'background',
              type: 'background',
              paint: { 'background-color': theme.background },
            },
          ],
        },
        center: [13.4095, 52.5208],
        zoom: 11,
        attributionControl: true,
      })
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

      const featureCollection = state.featureCollection || { type: 'FeatureCollection', features: [] }
      const coordinates = featureCollection.features.flatMap((feature) => {
        if (feature.geometry?.type === 'Point') return [feature.geometry.coordinates]
        return []
      })

      const fitToCoordinates = () => {
        if (coordinates.length === 0) return
        const bounds = coordinates.reduce(
          (acc, coordinate) => acc.extend(coordinate),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
        )
        map.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: 0 })
      }

      const addPmtilesBasemap = async () => {
        const pmtiles = new PMTiles(pmtilesUrl)
        protocol.add(pmtiles)
        map.addSource('taskyon-world-pmtiles', {
          type: 'vector',
          url: 'pmtiles://' + pmtilesUrl,
        })
        const metadata = await pmtiles.getMetadata()
        const layers = Array.isArray(metadata?.vector_layers) ? metadata.vector_layers : []
        layers.slice(0, 20).forEach((layer, index) => {
          if (!layer?.id) return
          map.addLayer(
            {
              id: 'taskyon-world-fill-' + index,
              type: 'fill',
              source: 'taskyon-world-pmtiles',
              'source-layer': layer.id,
              filter: ['==', ['geometry-type'], 'Polygon'],
              paint: {
                'fill-color': theme.fill,
                'fill-opacity': 0.2,
              },
            },
            'taskyon-result-points',
          )
          map.addLayer(
            {
              id: 'taskyon-world-line-' + index,
              type: 'line',
              source: 'taskyon-world-pmtiles',
              'source-layer': layer.id,
              paint: {
                'line-color': theme.line,
                'line-width': 0.8,
                'line-opacity': 0.72,
              },
            },
            'taskyon-result-points',
          )
          map.addLayer(
            {
              id: 'taskyon-world-point-' + index,
              type: 'circle',
              source: 'taskyon-world-pmtiles',
              'source-layer': layer.id,
              filter: ['==', ['geometry-type'], 'Point'],
              paint: {
                'circle-color': theme.point,
                'circle-radius': 2,
                'circle-opacity': 0.55,
              },
            },
            'taskyon-result-points',
          )
        })
      }

      const addRasterFallbackBasemap = () => {
        if (!map.getSource('taskyon-osm-raster')) {
          map.addSource('taskyon-osm-raster', {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          })
        }
        if (!map.getLayer('taskyon-osm-raster')) {
          map.addLayer(
            {
              id: 'taskyon-osm-raster',
              type: 'raster',
              source: 'taskyon-osm-raster',
              paint: { 'raster-opacity': prefersDark ? 0.55 : 0.8 },
            },
            'taskyon-result-points',
          )
        }
      }

      map.on('load', () => {
        map.addSource('taskyon-results', { type: 'geojson', data: featureCollection })
        map.addLayer({
          id: 'taskyon-result-points',
          type: 'circle',
          source: 'taskyon-results',
          filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
          paint: {
            'circle-color': '#f97316',
            'circle-radius': 6,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })
        addRasterFallbackBasemap()
        addPmtilesBasemap().catch((error) => {
          console.warn('PMTiles basemap unavailable', error)
        })
        ;(state.locations || []).forEach((location, index) => {
          const marker = document.createElement('div')
          marker.className = 'marker taskyon-geo-map-widget__marker'
          marker.textContent = String(index + 1)
          new maplibregl.Marker({ element: marker }).setLngLat([location.lng, location.lat]).addTo(map)
        })
        fitToCoordinates()
      })
    </script>
  </body>
</html>`
}

export const buildTaskyonMapWidgetHtml = (args: {
  iframeUrl: string
  title: string
  state: TaskyonMapWidgetState
}) => {
  const title = escapeHtmlAttr(args.title)
  const iframeUrl = escapeHtmlAttr(args.iframeUrl)
  const serializedState = escapeScriptJson(args.state)

  return `<div style="width:100%;max-width:100%;height:32rem;border:1px solid rgba(148,163,184,0.35);border-radius:0.75rem;overflow:hidden;background:#0f172a;">
  <iframe
    id="taskyon-map-widget-frame"
    src="${iframeUrl}"
    title="${title}"
    referrerpolicy="no-referrer"
    style="display:block;width:100%;height:100%;border:0;background:#0b1120;"
  ></iframe>
  <script>
    const frame = document.getElementById('taskyon-map-widget-frame')
    const state = ${serializedState}
    const sendState = () => {
      if (!frame || !frame.contentWindow) return
      frame.contentWindow.postMessage({ type: 'taskyon-map-widget-state', state }, '*')
    }
    if (frame) {
      frame.addEventListener('load', () => {
        sendState()
        setTimeout(sendState, 200)
        setTimeout(sendState, 1000)
      })
    }
  <\/script>
</div>`
}
