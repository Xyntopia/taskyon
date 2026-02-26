import type { Model } from 'openai/resources/models.mjs'
import { asyncTimeLruCache } from '../utils/caching'
// TODO: can we use this:  https://github.com/rexxars/eventsource-parser?

const availableModelsTmp = async (
  modelsUrl: string,
  apiKey: string,
  headers: Record<string, string>,
  invalidateCache = false,
): Promise<Record<string, Model>> => {
  try {
    // Construct the URL with an optional cache-busting query parameter
    const url = invalidateCache ? `${modelsUrl}?_=${new Date().getTime()}` : modelsUrl

    console.log('downloading model list')
    // Setting up the Fetch request
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        Authorization: `Bearer ${apiKey}`,
        //'Cache-Control': 'max-stale=3600',
        'Cache-Control': 'no-cache', // Ensure the freshest data is fetched as we're caching this function anyways...
      },
    })

    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Parse the JSON response
    const raw = (await response.json()) as { data?: Array<Model> } | Array<Model>
    const data = 'data' in raw && raw.data[0]?.id ? raw.data : (raw as Array<Model>)

    // Return the list of models directly
    const models = data.reduce<Record<string, Model>>((acc, m) => {
      acc[m.id] = m
      return acc
    }, {})
    return models
  } catch (error) {
    console.error('Error fetching models:', error)
    throw error // re-throwing the error to be handled by the calling code
  }
}

export const availableModels = asyncTimeLruCache(
  10, // max 10 entries
  60 * 60 * 1000, //1h
  true, // use localStorage for persistence
  'modelCache', // save it here..
)(availableModelsTmp)
