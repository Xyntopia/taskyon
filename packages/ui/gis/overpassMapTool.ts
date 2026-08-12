import { createClientTool } from '@taskyon/taskyon/api'
import type { JSONSchema7 } from 'json-schema'
import {
  buildDataAndMapTasks,
  buildMapToolDataResult,
  buildOverpassPreparationTask,
  getStructuredResultTask,
} from './mapToolShared'
import { isStructuredOverpassResult } from './overpassUtils'

const overpassMapToolSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Natural-language request that should be converted into an Overpass QL query.',
    },
    overpassQuery: {
      type: 'string',
      description: 'Optional raw Overpass QL query. If provided, it is executed directly.',
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema7

export const overpassMapTool = createClientTool({
  name: 'overpassMapTool',
  description:
    'Execute raw Overpass QL, or derive it from a natural-language request, and return both structured result data and an interactive map view.',
  longDescription:
    'Raw Overpass QL executes directly; natural-language requests first create a visible query-generation task. The completed workflow normalizes OpenStreetMap elements and exposes the same result as structured data and an interactive map.',
  parameters: overpassMapToolSchema,
  async function(args, context) {
    if (typeof args.overpassQuery === 'string' && args.overpassQuery.trim()) {
      const result = await buildMapToolDataResult({
        overpassQuery: args.overpassQuery,
        searchType: 'overpass results',
      })
      return buildDataAndMapTasks(result)
    }

    if (typeof args.query === 'string' && args.query.trim()) {
      return buildOverpassPreparationTask(args.query)
    }

    const structuredTask = getStructuredResultTask(await context.getExecutionTaskChain())
    if (!structuredTask || !isStructuredOverpassResult(structuredTask.content.data)) {
      throw new Error(
        'overpassMapTool expected either query, overpassQuery, or a structured Overpass result.',
      )
    }

    const result = await buildMapToolDataResult({
      overpassQuery: structuredTask.content.data.overpassQuery,
      searchType: structuredTask.content.data.searchType ?? 'overpass results',
    })
    return buildDataAndMapTasks(result)
  },
})
