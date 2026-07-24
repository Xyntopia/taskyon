import { fetchProviderModels } from '../cli/models'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testProviderModelDiscoveryCachesNormallyAndRefreshesOnDemand = async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []
  let responseModel = 'gpt-current-1'
  globalThis.fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requestedUrls.push(url)
    return Promise.resolve(
      new Response(
        JSON.stringify({ models: [{ slug: responseModel, input_modalities: ['text', 'image'] }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
  }

  try {
    const api = {
      provider: 'chatgpt-codex',
      name: 'chatgpt-codex',
      baseURL: 'https://models.test/codex',
      model: 'gpt-current-1',
      streamSupport: true,
      routes: { models: '/models', chatCompletion: '/responses' },
    }
    const first = await fetchProviderModels('chatgpt-codex', api, 'token')
    const cached = await fetchProviderModels('chatgpt-codex', api, 'token')
    responseModel = 'gpt-current-2'
    const refreshed = await fetchProviderModels('chatgpt-codex', api, 'token', {
      forceRefresh: true,
    })

    assert('gpt-current-1' in first, 'Expected the first provider response.')
    assert(
      first['gpt-current-1']?.architecture?.modality === 'text+image->text',
      'Expected Codex image-capable models to be marked as vision models.',
    )
    assert('gpt-current-1' in cached, 'Expected the cached provider response.')
    assert(
      'gpt-current-2' in refreshed,
      'Expected an explicit refresh to fetch the latest response.',
    )
    assert(
      requestedUrls.length === 2,
      `Expected two network requests, got ${requestedUrls.length}.`,
    )
    assert(
      requestedUrls[1]?.includes('_='),
      'Expected an explicit refresh to use a cache-busting request URL.',
    )
    assert(
      requestedUrls.every((url) => new URL(url).searchParams.get('client_version') === '0.144.5'),
      'Expected Codex model discovery to use the current Codex client version.',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}

testProviderModelDiscoveryCachesNormallyAndRefreshesOnDemand.description =
  'Caches normal provider model discovery but revalidates when an explicit refresh is requested.'
