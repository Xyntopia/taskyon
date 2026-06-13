import { createChatCompletionTask, createSubtasksResult, toolCall } from '@taskyon/taskyon/api'
import type { FeatureCollection } from 'geojson'
import type { JSONSchema7 } from 'json-schema'
import {
  buildStandaloneTaskyonMapWidgetHtml,
  type MapSearchLocation,
  type TaskyonMapWidgetState,
} from './taskyonMapWidget'
import {
  fetchOverpassElements,
  isStructuredOverpassResult,
  makeTaginfoContext,
  overpassToFeatureCollection,
  searchTaginfo,
  type OverpassElement,
} from './overpassUtils'

export const structuredOverpassResultSchema = {
  type: 'object',
  properties: {
    overpassQuery: {
      type: 'string',
      description: 'Complete Overpass QL query.',
    },
    searchType: {
      type: 'string',
      description: 'Short human-readable label for the requested map result.',
    },
  },
  required: ['overpassQuery', 'searchType'],
} as const satisfies JSONSchema7

export const overpassOnlyResultSchema = {
  type: 'object',
  properties: {
    overpassQuery: {
      type: 'string',
      description: 'Complete Overpass QL query.',
    },
  },
  required: ['overpassQuery'],
} as const satisfies JSONSchema7

export interface MapToolDataResult {
  overpassQuery: string
  searchType: string
  locations: MapSearchLocation[]
  featureCollection: FeatureCollection
}

export const createMapSearchPrompt = (
  query: string,
  taginfoContext: string,
) => `You are an OpenStreetMap expert.

Given this query: "${query}".

RELEVANT OSM TAGS FOUND: ${taginfoContext}

Generate a complete Overpass QL query that will find the requested locations.

Return structured data with:
- overpassQuery: complete Overpass QL query
- searchType: short human-readable description of the search

Requirements:
1. Autocorrect spelling mistakes in city names.
2. Map common English city names to OpenStreetMap local names when useful.
3. Use area search syntax when appropriate.
4. Return named results with coordinates when possible.
5. Prefer "out tags center geom;" so geometry is available for rendering.`

export const createOverpassPrompt = (
  query: string,
) => `Convert the following natural-language request into a complete Overpass QL query.

Request: "${query}"

Requirements:
1. Return a query that includes geometry suitable for GeoJSON map rendering.
2. Prefer "out tags center geom;" when possible.
3. Use area search syntax for named places when needed.
4. Return structured data with one field:
   - overpassQuery`

const buildWidgetState = (args: MapToolDataResult): TaskyonMapWidgetState => ({
  mode: 'geojson',
  query: args.overpassQuery,
  title: `Found ${args.locations.length || args.featureCollection.features.length} ${args.searchType}`,
  locations: args.locations,
  featureCollection: args.featureCollection,
})

const buildWidgetMessage = (state: TaskyonMapWidgetState) => {
  return buildStandaloneTaskyonMapWidgetHtml(state)
}

const uniqueLocations = (locations: MapSearchLocation[]) => {
  const seen = new Set<string>()
  return locations.filter((location) => {
    const key = `${location.name}:${location.lat}:${location.lng}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const extractElementLocation = (element: OverpassElement): MapSearchLocation | null => {
  if (typeof element.tags?.name !== 'string') return null

  const lat = element.lat ?? element.center?.lat ?? element.geometry?.[0]?.lat
  const lng = element.lon ?? element.center?.lon ?? element.geometry?.[0]?.lon
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    name: element.tags.name,
    lat,
    lng,
  }
}

export const extractLocations = (elements: OverpassElement[]) =>
  uniqueLocations(
    elements.map(extractElementLocation).filter((entry): entry is MapSearchLocation => !!entry),
  )

const summarizeLocations = (locations: MapSearchLocation[]) => {
  const listed = locations
    .slice(0, 10)
    .map(
      (location) => `• ${location.name} (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`,
    )
    .join('\n')

  if (locations.length <= 10) return listed
  return `${listed}\n... and ${locations.length - 10} more`
}

export const buildResultsMessage = (result: MapToolDataResult) => {
  if (result.locations.length === 0) {
    return `Found ${result.featureCollection.features.length} ${result.searchType}.`
  }

  return `Found ${result.locations.length || result.featureCollection.features.length} ${result.searchType}:\n\n${summarizeLocations(result.locations)}`
}

export const getStructuredResultTask = (
  taskChain: { role: string; content: { type: string; data: unknown } }[],
) => {
  const candidateTasks = [taskChain.at(-2), taskChain.at(-1)]
  return candidateTasks.find(
    (task) =>
      task?.role === 'assistant' &&
      task.content.type === 'structured' &&
      isStructuredOverpassResult(task.content.data),
  )
}

export const buildSearchPreparationTask = (query: string) =>
  searchTaginfo(query).then((taginfoResults) =>
    createSubtasksResult([
      [
        createChatCompletionTask({
          appendSystemPrompts: [createMapSearchPrompt(query, makeTaginfoContext(taginfoResults))],
          schema: structuredOverpassResultSchema,
        }),
        toolCall({
          name: 'mapSearchTool',
          arguments: {},
        }),
      ],
    ]),
  )

export const buildOverpassPreparationTask = (query: string) =>
  createSubtasksResult([
    [
      createChatCompletionTask({
        appendSystemPrompts: [createOverpassPrompt(query)],
        schema: overpassOnlyResultSchema,
      }),
      toolCall({
        name: 'overpassMapTool',
        arguments: {},
      }),
    ],
  ])

export const buildMapToolDataResult = async (args: {
  overpassQuery: string
  searchType: string
}): Promise<MapToolDataResult> => {
  const elements = await fetchOverpassElements(args.overpassQuery)
  return {
    overpassQuery: args.overpassQuery,
    searchType: args.searchType,
    locations: extractLocations(elements),
    featureCollection: overpassToFeatureCollection(elements),
  }
}

export const buildDataAndMapTasks = (result: MapToolDataResult) => {
  if (result.featureCollection.features.length === 0 && result.locations.length === 0) {
    return createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `No ${result.searchType} found. Try a different city or more specific search terms.`,
          },
        },
      ],
    ])
  }

  const widgetState = buildWidgetState(result)

  return createSubtasksResult([
    [
      {
        role: 'system',
        content: {
          type: 'toolresult',
          data: result,
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'message',
          data: buildResultsMessage(result),
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'message',
          data: buildWidgetMessage(widgetState),
        },
      },
    ],
  ])
}
