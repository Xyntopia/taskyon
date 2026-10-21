import { buildPmtilesUrlCandidates } from '@taskyon/maplibre'
import { createMediatedFetch } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { createExternalToolContext } from '@taskyon/taskyon'
import { buildDataAndMapTasks, buildMapToolDataResult } from '@taskyon/ui/gis/mapToolShared'
import { overpassMapTool } from '@taskyon/ui/gis/overpassMapTool'
import { parseTaskyonMapWidgetState } from '@taskyon/ui/gis/taskyonMapWidget'
import { taskResult } from '@taskyon/taskyon/api'
import { readFile } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import { fileURLToPath } from 'node:url'
import { renderTaskProgress } from '../../cli/taskRenderer'
import overpassCafeResponse from './fixtures/overpass-cafes-zurich.json' with { type: 'json' }

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const assertJsonEqual = (actual: unknown, expected: unknown, message: string) => {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message)
}

// Recorded from https://overpass.osm.ch/api/interpreter on 2026-10-17 because the canonical
// overpass-api.de instance temporarily throttled this IP after manual probing. Requested with:
// [out:json][timeout:25];node["amenity"="cafe"](around:250,47.3782,8.5392);out 30 tags center geom;
const overpassInterpreterUrl = 'https://overpass-api.de/api/interpreter'
const overpassCafeQuery =
  '[out:json][timeout:25];node["amenity"="cafe"](around:250,47.3782,8.5392);out 30 tags center geom;'
const recordedCafeNames = overpassCafeResponse.elements
  .map((element) => {
    const tags: Record<string, string> | undefined = element.tags
    return tags?.name
  })
  .filter((name): name is string => typeof name === 'string')

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
  const request: typeof fetch = (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== overpassInterpreterUrl) {
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    }

    return Promise.resolve(
      new Response(JSON.stringify(overpassCafeResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  const result = await buildMapToolDataResult(
    {
      overpassQuery: overpassCafeQuery,
      searchType: 'overpass results',
    },
    request,
  )

  assert(
    result.locations.length === overpassCafeResponse.elements.length,
    'Expected one location per recorded Overpass element',
  )
  assert(
    result.featureCollection.features.length === overpassCafeResponse.elements.length,
    'Expected one GeoJSON feature per recorded Overpass element',
  )

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
  assert(
    parsed.featureCollection?.features.length === overpassCafeResponse.elements.length,
    'Expected every recorded Overpass element in the parsed widget state',
  )
  assert(
    recordedCafeNames.every((name) => parsed.locations.some((location) => location.name === name)),
    'Expected parsed widget state to include every recorded cafe',
  )
}

export const testCliOverpassMapToolPrintsHtmlPreviewLink = async () => {
  const requests: Array<{ url: string; method: string }> = []
  const fetchWithFixture = createMediatedFetch({
    authorize: (capability) =>
      Promise.resolve(
        capability.action === 'fetch' &&
          capability.origin === 'https://overpass-api.de' &&
          capability.access === 'write',
      ),
    fetch: (input, init) => {
      const request = new Request(input, init)
      requests.push({ url: request.url, method: request.method })
      return Promise.resolve(
        new Response(JSON.stringify(overpassCafeResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    },
  })

  const toolResult = await overpassMapTool.function(
    { overpassQuery: overpassCafeQuery },
    createExternalToolContext(new AbortController().signal, { fetch: fetchWithFixture }),
  )
  const tasks = taskResult.parse(toolResult)
  const mapMessage = tasks.taskChainList
    .flat()
    .find(
      (task) =>
        task.role === 'assistant' &&
        task.content.type === 'message' &&
        typeof task.content.data === 'string' &&
        task.content.data.includes('taskyon-world-pmtiles'),
    )
  if (mapMessage?.content.type !== 'message' || typeof mapMessage.content.data !== 'string') {
    throw new Error('Expected the overpass tool to return an assistant map widget message')
  }

  const lines: string[] = []
  renderTaskProgress(
    {
      detailedViewEnabled: () => false,
      showRoleTag: () => true,
      showFullFunctionResults: () => false,
      isFunctionHiddenInChat: () => false,
      clearThinkingPanel: () => {},
      renderThinkingPanel: () => {},
      writeLine: (text: string) => {
        lines.push(text)
      },
    },
    {
      id: 'overpass-map-preview',
      role: 'assistant',
      content: { type: 'message', data: mapMessage.content.data },
    },
    false,
  )

  const output = stripVTControlCharacters(lines.join('\n'))
  const previewUrl = /HTML preview: (file:\/\/\S+)/.exec(output)?.[1]
  if (!previewUrl) throw new Error(`Expected an HTML preview link in the CLI output:\n${output}`)

  const previewHtml = await readFile(fileURLToPath(previewUrl), 'utf8')
  assert(previewHtml.includes('<!doctype html>'), 'Expected a standalone HTML preview document')
  assert(
    previewHtml.includes('taskyon-world-pmtiles'),
    'Expected the map widget viewer in the preview',
  )
  assert(
    recordedCafeNames.every((name) => previewHtml.includes(name)),
    'Expected every recorded cafe in the preview document',
  )

  assert(requests.length === 1, `Expected one mediated request, got ${String(requests.length)}`)
  assert(requests[0]?.url === overpassInterpreterUrl, 'Expected the Overpass interpreter endpoint')
  assert(requests[0]?.method === 'POST', 'Expected the Overpass query to use POST')

  let denied = false
  try {
    await fetchWithFixture('https://example.test/api/interpreter', { method: 'POST', body: 'x' })
  } catch {
    denied = true
  }
  assert(denied, 'The scoped fetch policy must deny writes outside the Overpass origin')
}

testCliOverpassMapToolPrintsHtmlPreviewLink.description =
  'Runs overpassMapTool against a recorded real Overpass response and verifies the CLI writes an HTML preview.'
