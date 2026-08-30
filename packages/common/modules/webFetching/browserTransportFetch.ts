import type { FetchWithPolicy } from './mediatedFetch'

export const TASKYON_DEV_CORS_PROXY_PATH = '/__taskyon_dev_proxy/'

const proxyRequestUrl = (proxyUrl: string, target: URL) => {
  const prefix = proxyUrl.endsWith('/') ? proxyUrl : `${proxyUrl}/`
  return `${prefix}${target.href}`
}

export function createCorsAnywhereFetch(options: {
  proxyUrl: string
  fetch?: typeof fetch
}): FetchWithPolicy {
  const hostFetch = options.fetch ?? globalThis.fetch
  return async (input, init = {}) => {
    const request = new Request(input, init)
    const target = new URL(request.url)
    const headers = new Headers(request.headers)
    headers.set('x-requested-with', 'Taskyon')
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer()
    return await hostFetch(proxyRequestUrl(options.proxyUrl, target), {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      credentials: 'omit',
      redirect: request.redirect,
      signal: request.signal,
    })
  }
}
