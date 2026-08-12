import { createClientTool } from '@taskyon/taskyon/api'
import type { JSONSchema7 } from 'json-schema'
import {
  buildDataAndMapTasks,
  buildMapToolDataResult,
  buildSearchPreparationTask,
  getStructuredResultTask,
} from './mapToolShared'
import { isStructuredOverpassResult } from './overpassUtils'

const mapSearchToolSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'Natural-language place search such as "cafes in Paris" or "solar power in San Diego".',
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const satisfies JSONSchema7

export const mapSearchTool = createClientTool({
  name: 'mapSearchTool',
  description:
    'Search OpenStreetMap data from a natural-language request and return both structured result data and an interactive map view.',
  longDescription:
    'The first phase converts the request into a structured Overpass search task. A continuation executes the query, normalizes matching OpenStreetMap elements, and returns both reusable structured data and a rendered map.',
  parameters: mapSearchToolSchema,
  async function(args, context) {
    if (typeof args.query === 'string' && args.query.trim()) {
      return buildSearchPreparationTask(args.query)
    }

    const structuredTask = getStructuredResultTask(await context.getExecutionTaskChain())
    if (!structuredTask || !isStructuredOverpassResult(structuredTask.content.data)) {
      throw new Error('mapSearchTool expected either query or a structured Overpass search result.')
    }

    const result = await buildMapToolDataResult({
      overpassQuery: structuredTask.content.data.overpassQuery,
      searchType: structuredTask.content.data.searchType ?? 'map results',
    })
    return buildDataAndMapTasks(result)
  },
})
