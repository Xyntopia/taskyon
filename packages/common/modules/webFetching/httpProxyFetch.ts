import type { FetchWithPolicy } from './mediatedFetch'

export type HttpProxyTokenProvider = (
  target: URL,
  refreshInstanceKey?: boolean,
) => Promise<string | undefined>

const hasInstanceKeyMismatch = async (response: Response) =>
  response.status === 401 && (await response.clone().text()).includes('instance_key_mismatch')

export function createHttpProxyFetch(options: {
  proxyUrl: string
  fetch?: typeof fetch
  getToken?: HttpProxyTokenProvider
}): FetchWithPolicy {
  const hostFetch = options.fetch ?? globalThis.fetch
  return async (input, init = {}, fetchOptions = {}) => {
    if (fetchOptions.policy === 'direct') return await hostFetch(input, init)

    const target = new URL(input instanceof Request ? input.url : input)
    const proxyUrl = new URL(options.proxyUrl)
    proxyUrl.searchParams.set('url', target.href)
    if (fetchOptions.proxy?.cacheBust) proxyUrl.searchParams.set('cb', crypto.randomUUID())
    if (fetchOptions.proxy?.stripHeaders) proxyUrl.searchParams.set('sH', '1')

    const send = async (refreshInstanceKey = false) => {
      const headers = new Headers(init.headers)
      const token = await options.getToken?.(target, refreshInstanceKey)
      if (token) headers.set('authorization', `Bearer ${token}`)
      return await hostFetch(proxyUrl, { ...init, headers })
    }
    const response = await send()
    return options.getToken && (await hasInstanceKeyMismatch(response))
      ? await send(true)
      : response
  }
}
