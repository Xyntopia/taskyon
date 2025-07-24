import type { JSONSchema7 } from 'json-schema'
// import type { JSONSchema } from 'json-schema-to-ts'
// import type { ToolBase } from '../taskyon/types'
import { createTool, toolCall, makeTaskResult } from '../taskyon/tools'
import { sha256UrlSafeHash } from '../crypto'
import { createVectorStore } from '../crudWrapper'
import { getDatabase } from '../pglite.api'
// import { smallHelperTools } from './helperCollection'

// const jinaTool = smallHelperTools.find(
//   (tool) => tool.name === 'jinaSearch',
// )! as unknown as ToolBase & { parameters: Readonly<JSONSchema> }
// const jinaSearchTool = createTool(jinaTool)

// TODO: make it possible to add "unique" identifiers as labels, so that
//       we can save text which was add from a task and use the task id as the UID
export const ragSearchTool = createTool({
  name: 'ragSearchTool',
  description: `This tool can perform the search functionality of Retrieval Augmented Generation. This tool can use any source of information and generate a context aware answer.
  It is useful for use information sources with high relevance and give natural language answers to natural language queries. You can use source types to
  make sure that the search uses specific sources.`,
  parameters: {
    type: 'object',
    properties: {
      searchText: {
        type: 'string',
        description: 'The search term to use in the vector store search.',
      },
      k: {
        type: 'number',
        description: 'The number of nearest neighbors to retrieve in the search.',
        default: 5,
      },
      sourceType: {
        type: 'string',
        description: 'The type of source to use for the search.',
        enum: ['web', 'vectorStore', 'localFile'],
        default: 'vectorStore',
      },
      label: {
        type: 'string',
        description: 'The label for the string to be saved.',
      },
    },
    required: ['searchText', 'sourceType'],
  } as const satisfies JSONSchema7,
  function: async ({ searchText, k, sourceType, label }) => {
    if (sourceType === 'vectorStore') {
      const { search } = await createVectorStore(await getDatabase('taskyon'), 'vectorStoreTool')

      if (searchText) {
        const searchResults = await search(searchText, k, [], { label })
        return makeTaskResult([
          [
            {
              role: 'system',
              content: {
                type: 'message',
                data: `Here are the search results for "${searchText}":\n${JSON.stringify(searchResults, null, 2)}`,
              },
            },
            toolCall({
              name: 'chatCompletion',
              arguments: {
                prompts: [
                  `Based on the search results above, please provide a comprehensive answer to the query: "${searchText}".
                  Use the information from the search results and format your response in a clear, well-structured way.`,
                ],
              },
            }),
          ],
        ])
      }

      throw new Error('searchText parameter must be provided')
    } else if (sourceType === 'web') {
      const task = toolCall({
        name: 'jinaSearch',
        arguments: {
          query: searchText,
        },
      })

      return makeTaskResult([
        [
          task,
          toolCall({
            name: 'chatCompletion',
            arguments: {
              prompts: [
                `Based on the web search results above, please provide a comprehensive answer to the query: "${searchText}".
                Use the information from the search results and format your response in a clear, well-structured way.
                List all the references below the answer, make sure all the links open in a new tab.`,
              ],
            },
          }),
        ],
      ])
    }
  },
})

export const ragAddTool = createTool({
  name: 'ragAddTool',
  description: `This tool can add content to the vector store. This tool can use any source of information and add it to the vector store.
  It is useful for use information sources with high relevance and add it to the vector store. You can use source types to
  make sure that the search uses specific sources.`,
  parameters: {
    type: 'object',
    properties: {
      inputType: {
        type: 'string',
        description: 'The type of source to add to the vector store.',
        enum: ['web', 'userInput', 'localFile'],
        default: 'userInput',
      },
      saveText: {
        type: 'string',
        description:
          'The string to be saved in the vector database if the input type is userInput.',
      },
      label: {
        type: 'string',
        description: 'The label for the string to be saved if the input type is userInput.',
      },
      url: {
        type: 'string',
        description:
          'The URL of the webpage to read and add to the vector store if the input type is web.',
      },
      localFileName: {
        type: 'string',
        description:
          'The name of the local file to add to the vector store if the input type is localFile.',
      },
    },
    required: ['inputType'],
  } as const satisfies JSONSchema7,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function: async ({ inputType, saveText, label, url, localFileName }) => {
    if (inputType === 'userInput') {
      const id = await sha256UrlSafeHash(saveText)
      const { upsert } = await createVectorStore(await getDatabase('taskyon'), 'vectorStoreTool')
      if (saveText) {
        await upsert(id, saveText, { label })
        return { message: 'Data saved successfully' }
      }
      throw new Error('saveText parameter must be provided')
    }

    throw new Error('Invalid input type')
  },
})
