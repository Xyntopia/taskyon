import type { taskResult } from '@taskyon/taskyon'
import { createTool, makeTaskResult, toolCall } from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'
// import type { TyTaskManager } from 'src/modules/taskyon/taskManager'
import { match, P } from 'ts-pattern'

async function getOSMData(overpassQL: string): Promise<{ OSMData: string }> {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: overpassQL,
  })
  const json = await res.json()

  return {
    OSMData: JSON.stringify(json),
  }
}

// export const overpassMapTool = createTool({
//   name: 'overpassMapTool',
//   description: `This tool converts a location query into Overpass QL format, and then show the layers on the map`,
//   parameters: {
//     type: 'object',
//     properties: {
//       query: {
//         type: 'string',
//         description: 'The location or place name.',
//       },
//     },
//     required: ['query'],
//   } as const satisfies JSONSchema7,
//   function: async (_, {taskChain}) => {
//     // need to extract location fron Query first with LLMs
//     console.log('Generating Overpass QL...')
//     console.log('Query Task chain:', taskChain.at(-1))
//     const result = await match(taskChain.at(-1))
//       .returnType<taskResult | Promise<taskResult>>()

//       // Match: user message with string content
//       .with({ content: { type: 'functioncall', data: {
//         arguments: {
//           query: P.string,
//         },
//       }, } }, ({ content }) => {
//         const userQuery = content.data.arguments.query
//         console.log('User query:', userQuery)

//         return makeTaskResult([
//           [
//             createChatCompletionTask({
//               prompts: [
//                 `Convert the following natural language query into Overpass QL. Respond in JSON format with a single key 'overpassQL'.\n\nQuery: "${userQuery}"`,
//               ],
//               schema: {
//                 type: 'object',
//                 properties: {
//                   overpassQL: {
//                     type: 'string',
//                     description: 'Overpass QL corresponding to the natural language query.',
//                   },
//                 },
//                 required: ['overpassQL'],
//               },
//             }),
//           ],

//         ])
//       })

//       // Error: no valid previous task
//       .otherwise(() => {
//         throw new Error('No valid previous message to extract Overpass QL from.')
//       })
//       console.log('Overpass QL generated:', result)
//       console.log('Task chain QL:', taskChain.at(-1))

//     // const overpassQL = await processQueryIntoQL(query)
//     // const OSMData = await getOSMData(overpassQL)
//     // if (overpassQL.length === 0) {
//     //   return makeTaskResult([
//     //     [
//     //       {
//     //         role: 'system',
//     //         content: {
//     //           type: 'message',
//     //           data: `No locations found for query "${query}".`,
//     //         },
//     //       },
//     //     ],
//     //   ])
//     // }

//     // // Use first location to create embedded map URL
//     // const messageData = `Overpass Turbo map results for "${query}":\n\n`

//     // return makeTaskResult([
//     //   [
//     //     {
//     //       role: 'system',
//     //       content: {
//     //         type: 'message',
//     //         data: messageData,
//     //       },
//     //     },
//     //     createToolTask({
//     //       name: 'show_map',
//     //       arguments: {
//     //         prompts: [
//     //           `Display an Overpass Turbo map with the following OverpassQL codes: ${overpassQL}`,
//     //         ],
//     //       },
//     //     }),
//     //   ],
//     // ])
//   },
// })
// export const overpassMapTool = createTool({
//   name: 'overpassMapTool',
//   description: `This tool converts a location query into Overpass QL format, and then shows the layers on the map`,
//   parameters: {
//     type: 'object',
//     properties: {
//       query: {
//         type: 'string',
//         description: 'The location or place name.',
//       },
//     },
//     required: ['query'],
//   } as const satisfies JSONSchema7,

//   function: async (_, { taskChain }) => {
//     console.log('Generating Overpass QL...')
//     const last = taskChain.at(-1)
//     console.log('Last on Query Task chain:', last)

//     const result = await match(last)
//       .returnType<taskResult | Promise<taskResult>>()

//       // STEP 1: The user passed a query — create an LLM task
//       .with({
//         content: {
//           type: 'functioncall',
//           data: {
//             arguments: {
//               query: P.string,
//             },
//           },
//         },
//       }, ({ content }) => {
//         const userQuery = content.data.arguments.query
//         console.log('User query:', userQuery)

//         return makeTaskResult([
//           [
//             createChatCompletionTask({
//               prompts: [
//                 `Convert the following natural language query into Overpass QL. Respond in JSON format with a single key 'overpassQL'.\n\nQuery: "${userQuery}"`,
//               ],
//               schema: {
//                 type: 'object',
//                 properties: {
//                   overpassQL: {
//                     type: 'string',
//                     description: 'Overpass QL corresponding to the natural language query.',
//                   },
//                 },
//                 required: ['overpassQL'],
//               },
//             }),
//           ],
//         ])
//       })
//       // STEP 2: We got the result from the LLM — extract overpassQL and show map
//       .with({
//         role: 'assistant',
//         content: {
//           type: 'structured',
//           data: {
//             overpassQL: P.string,
//           },
//         },
//       }, ({ content }) => {

//         const overpassQL = content.data.overpassQL
//         console.log('LLM Overpass QL:', overpassQL)

//         return makeTaskResult([
//           [
//             {
//               role: 'system',
//               content: {
//                 type: 'message',
//                 data: `Overpass QL generated:\n\n${overpassQL}`,
//               },
//             },
//             createToolTask({
//               name: 'show_map',
//               arguments: {
//                 prompts: [
//                   `Display this Overpass QL on a map:\n\n${overpassQL}`,
//                 ],
//               },
//             }),
//           ],
//         ])
//       })

//       // STEP 3: No valid task to extract from
//       .otherwise(() => {
//         throw new Error('No valid previous task to extract Overpass QL from.')
//       })

//       console.log('Overpass QL generated:', result)
//       console.log('Task chain QL:', taskChain)

//     return result
//   },
// })

export const overpassMapTool = createTool({
  name: 'overpassMapTool',
  description: `This tool converts a location query into Overpass QL format, and then shows the layers on the map`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The location or place name.',
      },
    },
    required: ['query'],
  } as const satisfies JSONSchema7,
  function: async (query, { taskChain }) => {
    console.log('Raw taskChain:', JSON.stringify(taskChain, null, 2))

    const query_last = taskChain.at(-1)
    const ql_task = taskChain.at(-2)

    const hasValidQL =
      ql_task &&
      ql_task.role === 'assistant' &&
      typeof ql_task.content === 'object' &&
      ql_task.content.type === 'structured'

    let last: typeof query_last
    if (hasValidQL) {
      last = ql_task
    } else {
      last = query_last
    }

    const result = await match(last)
      .returnType<taskResult | Promise<taskResult>>()

      // STEP 1: handle initial user query
      .with(
        {
          content: {
            type: 'functioncall',
            data: {
              arguments: {
                query: P.string,
              },
            },
          },
        },
        ({ content }) => {
          const query = content.data.arguments.query
          console.log('Received user query:', query)

          return makeTaskResult([
            [
              createChatCompletionTask({
                prompts: [
                  `Convert the following natural language query into Overpass QL. Respond in JSON format with a single key 'overpassQL'.\n\nQuery: "${query}"`,
                ],
                schema: {
                  type: 'object',
                  properties: {
                    overpassQL: {
                      type: 'string',
                      description: 'Overpass QL corresponding to the natural language query.',
                    },
                  },
                  required: ['overpassQL'],
                },
              }),
              toolCall({
                name: 'overpassMapTool',
                arguments: {},
              }),
            ],
          ])
        },
      )

      // STEP 2: handle LLM response with Overpass QL
      .with(
        {
          role: 'assistant',
          content: {
            type: 'structured',
            data: {
              overpassQL: P.string,
            },
          },
        },
        async ({ content }) => {
          const overpassQL = content.data.overpassQL
          console.log('Received Overpass QL:', overpassQL)
          const OSMData = await getOSMData(overpassQL)
          console.log('OSM Data:', OSMData)
          const osmJson = JSON.parse(OSMData.OSMData) // parse string to object

          return makeTaskResult([
            [
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: `Overpass QL generated:\n\n${overpassQL}, OSM Data fetched successfully:\n\n${OSMData.OSMData}.`,
                },
              },
              // replace the data with html to show the layers, takyon will automatically render the map in markdown mode
              {
                role: 'system',
                content: {
                  type: 'message',
                  data: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8" />
                  <title>OSM Data Map Viewer</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1" />
                  <link
                    rel="stylesheet"
                    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
                    crossorigin=""
                  />
                  <style>
                    body, html { margin: 0; padding: 0; height: 100%; }
                    #map { width: 100%; height: 100vh; }
                  </style>
                </head>
                <body>
                  <div id="map"></div>

                  <script
                    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
                    crossorigin=""
                  ></script>
                  <script src="https://unpkg.com/osmtogeojson@3.0.0/osmtogeojson.js"></script>

                  <script>
                    // Define your OSM JSON data string here

                    function renderMap(osmDataStr) {
                      const osmJson = ${JSON.stringify(osmJson)};
                      const geojson = osmtogeojson(osmJson);

                      // Calculate center of the map: use first feature's center or default
                      let center = [0, 0];
                      if (geojson.features.length) {
                        const firstGeom = geojson.features[0].geometry;
                        if (firstGeom.type === "Point") {
                          center = [firstGeom.coordinates[1], firstGeom.coordinates[0]];
                        } else if (firstGeom.type === "Polygon" || firstGeom.type === "MultiPolygon") {
                          center = [firstGeom.coordinates[0][0][1], firstGeom.coordinates[0][0][0]];
                        }
                      }

                      // Initialize Leaflet map
                      const map = L.map('map').setView(center, 15);

                      // Add OpenStreetMap tile layer
                      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19,
                        attribution: '© OpenStreetMap contributors'
                      }).addTo(map);

                      // Add GeoJSON layer with popup showing name tag if available
                      L.geoJSON(geojson, {
                        style: () => ({ color: 'blue', weight: 2 }),
                        onEachFeature: (feature, layer) => {
                          const name = feature.properties?.tags?.name;
                          if (name) {
                            layer.bindPopup(name);
                          }
                        }
                      }).addTo(map);

                      // Fit map bounds to GeoJSON features
                      const bounds = L.geoJSON(geojson).getBounds();
                      if (bounds.isValid()) {
                        map.fitBounds(bounds);
                      }
                    }

                    // Call renderMap with your OSM data string
                    renderMap(osmDataString);
                  </script>
                </body>
                </html>
                `,
                },
              },
            ],
          ])
        },
      )

      .otherwise((content) => {
        console.warn('Unmatched content:', JSON.stringify(content, null, 2))
        throw new Error('Unexpected task state — neither user query nor LLM response found.')
      })

    return result
  },
})
