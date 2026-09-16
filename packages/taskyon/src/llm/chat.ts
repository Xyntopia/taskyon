import type { Model } from 'openai/resources/models.mjs'
import { asyncTimeLruCache } from '../utils/caching'
// TODO: can we use this:  https://github.com/rexxars/eventsource-parser?

const readStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const propertyValue = Reflect.get(value, property)
  return typeof propertyValue === 'string' ? propertyValue : undefined
}

const readNumberProperty = (value: unknown, property: string): number | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const propertyValue = Reflect.get(value, property)
  return typeof propertyValue === 'number' ? propertyValue : undefined
}

const normalizeModel = (value: unknown): Model | undefined => {
  const id = readStringProperty(value, 'id')
  if (!id) return undefined
  return {
    id,
    created: readNumberProperty(value, 'created') ?? 0,
    object: 'model',
    owned_by: readStringProperty(value, 'owned_by') ?? 'unknown',
  }
}

const normalizeCodexModel = (value: unknown): Model | undefined => {
  const slug = readStringProperty(value, 'slug')
  if (!slug) return undefined
  return {
    id: slug,
    created: 0,
    object: 'model',
    owned_by: 'openai',
  }
}

const normalizeModels = (
  values: unknown[],
  normalize: (value: unknown) => Model | undefined,
): Model[] =>
  values.flatMap((value) => {
    const model = normalize(value)
    return model ? [model] : []
  })

const readModelList = (value: unknown): Model[] => {
  if (Array.isArray(value)) {
    const models = normalizeModels(value, normalizeModel)
    return models.length > 0 ? models : normalizeModels(value, normalizeCodexModel)
  }
  if (typeof value !== 'object' || value === null) return []

  const data = Reflect.get(value, 'data')
  if (Array.isArray(data)) {
    const models = normalizeModels(data, normalizeModel)
    if (models.length > 0) return models
  }

  const models = Reflect.get(value, 'models')
  return Array.isArray(models) ? normalizeModels(models, normalizeCodexModel) : []
}

export const fetchAvailableModels = async (
  modelsUrl: string,
  apiKey: string,
  headers: Record<string, string>,
  invalidateCache = false,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Model>> => {
  try {
    // Construct the URL with an optional cache-busting query parameter
    const url = invalidateCache ? `${modelsUrl}?_=${new Date().getTime()}` : modelsUrl

    console.log('downloading model list')
    // Setting up the Fetch request
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...headers,
        Authorization: `Bearer ${apiKey}`,
      },
    })

    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Parse the JSON response. Codex returns `{ models: [{ slug }] }`, while
    // OpenAI-compatible providers generally return `{ data: [{ id }] }`.
    const data = readModelList(await response.json())

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
)(fetchAvailableModels)
