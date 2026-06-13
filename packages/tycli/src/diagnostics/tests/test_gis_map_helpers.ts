import { buildPmtilesUrlCandidates } from '@taskyon/common/modules/pmtilesUtils'
import { buildDataAndMapTasks, buildMapToolDataResult } from '@taskyon/ui/gis/mapToolShared'
import { parseTaskyonMapWidgetState } from '@taskyon/ui/gis/taskyonMapWidget'
import { taskResult } from '@taskyon/taskyon/api'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const assertJsonEqual = (actual: unknown, expected: unknown, message: string) => {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message)
}

export const testPmtilesUrlCandidateHelpers = () => {
  assertJsonEqual(
    buildPmtilesUrlCandidates('https://example.test/world.pmtiles'),
    ['https://example.test/world.pmtiles'],
    'Expected exact PMTiles URL to stay unchanged',
  )

  assertJsonEqual(
    buildPmtilesUrlCandidates('https://example.test/maps/', {
      suffixes: ['world.pmtiles', '/basemap.pmtiles', ''],
    }),
    [
      'https://example.test/maps',
      'https://example.test/maps.pmtiles',
      'https://example.test/maps/world.pmtiles',
      'https://example.test/maps/basemap.pmtiles',
    ],
    'Expected directory PMTiles URL candidates',
  )
}

export const testTaskyonMapWidgetStateParser = () => {
  const parsed = parseTaskyonMapWidgetState({
    mode: 'geojson',
    query: 'cafes in Paris',
    locations: [{ name: 'Cafe', lat: 48.8566, lng: 2.3522 }],
    featureCollection: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
          properties: { name: 'Cafe' },
        },
      ],
    },
  })

  if (!parsed) throw new Error('Expected valid map widget state')
  assert(parsed.mode === 'geojson', 'Expected geojson widget mode')
  assert(parsed.featureCollection?.features.length === 1, 'Expected one parsed feature')
  assert(
    parseTaskyonMapWidgetState({ mode: 'locations', query: 'empty', locations: [] }) === null,
    'Expected empty locations state to be rejected',
  )
}

export const testOverpassMapToolBuildsChatMapWidget = async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) !== 'https://overpass-api.de/api/interpreter') {
      throw new Error(`Unexpected fetch URL: ${String(input)}`)
    }

    return new Response(
      JSON.stringify({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 52.521,
            lon: 13.4094,
            tags: { name: 'Cafe Alexanderplatz', amenity: 'cafe' },
          },
          {
            type: 'node',
            id: 2,
            lat: 52.5263,
            lon: 13.4112,
            tags: { name: 'Cafe Rosa Luxemburg', amenity: 'cafe' },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const result = await buildMapToolDataResult({
      overpassQuery:
        '[out:json];node["amenity"="cafe"](around:300,52.5208,13.4095);out tags center geom;',
      searchType: 'overpass results',
    })

    assert(result.locations.length === 2, 'Expected two Overpass locations')
    assert(result.featureCollection.features.length === 2, 'Expected two GeoJSON features')

    const tasks = taskResult.parse(buildDataAndMapTasks(result))
    const mapMessage = tasks.taskChainList.flat().find((task) => {
      if (task.role !== 'assistant' || task.content.type !== 'message') return false
      return (
        typeof task.content.data === 'string' && task.content.data.includes('taskyon-world-pmtiles')
      )
    })

    if (mapMessage?.content.type !== 'message' || typeof mapMessage.content.data !== 'string') {
      throw new Error('Expected assistant map widget message')
    }
    const mapHtml = mapMessage.content.data
    assert(
      mapHtml.includes('<!doctype html>'),
      'Expected Node map widget message to be standalone HTML',
    )
    const stateMatch = mapHtml.match(/const state = (.+)\n/)
    const serializedState = stateMatch?.[1]
    if (!serializedState) throw new Error('Expected serialized widget state')

    const parsed = parseTaskyonMapWidgetState(JSON.parse(serializedState))
    if (!parsed) throw new Error('Expected parseable widget state')
    assert(parsed.featureCollection?.features.length === 2, 'Expected two parsed GeoJSON features')
    assert(
      parsed.locations.some((location) => location.name === 'Cafe Alexanderplatz'),
      'Expected parsed widget state to include Cafe Alexanderplatz',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}
