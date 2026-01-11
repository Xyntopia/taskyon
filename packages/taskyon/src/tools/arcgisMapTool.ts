import type { JSONSchema7 } from 'json-schema'
import { createTool, createToolTask, makeTaskResult } from '../taskyon/tools'

interface Location {
  coordinates: [number, number]
  displayName: string
}

interface ArcGISResult {
  feature?: { geometry?: { x: number; y: number } }
  name?: string
  attributes?: { PlaceName?: string }
}

async function getArcGISLocations(query: string): Promise<Location[]> {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/find?text=${encodedQuery}&f=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ArcGIS data: ${res.statusText}`)

  const json: { locations?: ArcGISResult[]; results?: ArcGISResult[] } = await res.json()
  const results = json.locations ?? json.results ?? []

  return results.map((item) => {
    const x = item.feature?.geometry?.x ?? 0
    const y = item.feature?.geometry?.y ?? 0
    const displayName = item.name ?? item.attributes?.PlaceName ?? 'Unknown location'
    return { coordinates: [x, y], displayName }
  })
}

export const arcgisMapTool = createTool({
  name: 'arcgisMapTool',
  description: `This tool queries ArcGIS geocoding API for locations matching the input query,
returns locations with coordinates, and provides a URL to an embedded ArcGIS map.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The location or place name to search on the ArcGIS map.',
      },
    },
    required: ['query'],
  } as const satisfies JSONSchema7,
  function: async ({ query }) => {
    // need to extract location fron Query first with LLMs
    const locations = await getArcGISLocations(query)
    if (locations.length === 0) {
      return makeTaskResult([
        [
          {
            role: 'system',
            content: {
              type: 'message',
              data: `No locations found for query "${query}".`,
            },
          },
        ],
      ])
    }

    // Use first location to create embedded map URL
    const first = locations[0]
    if (!first) {
      throw new Error('Unexpected empty locations array')
    }
    const [x, y] = first.coordinates
    const mapUrl = `https://www.arcgis.com/home/webmap/viewer.html?center=${x},${y}&level=13`


    // Format a simple summary string of all found locations
    const locationsText = locations
      .map((loc, i) => `${i + 1}. ${loc.displayName} [${loc.coordinates[0].toFixed(4)}, ${loc.coordinates[1].toFixed(4)}]`)
      .join('\n')

    // Compose the message data string, including the map URL (you can adapt if your frontend renders HTML)
    const messageData = `ArcGIS map results for "${query}":\n\n${locationsText}\n\nView map: ${mapUrl}`

    return makeTaskResult([
      [
        {
          role: 'system',
          content: {
            type: 'message',
            data: messageData,
          },
        },
        createToolTask({
          name: 'show_map',
          arguments: {
            prompts: [
              `Display an ArcGIS map centered on the location "${first.displayName}" at coordinates (${x}, ${y}). Map URL: ${mapUrl}`,
            ],
          },
        }),
      ],
    ])
  },
})
