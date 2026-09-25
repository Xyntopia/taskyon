import {
  isPrivateSandboxFetchUrl,
  resolveSandboxFetchTransport,
  type SandboxFetchPolicy,
  type SandboxFetchTransport,
} from '@taskyon/common/modules/webFetching/mediatedFetch'

export function resolveToolHostTransport(options: {
  request: Request
  configured: SandboxFetchTransport
  policy: SandboxFetchPolicy
  preferProxy?: boolean
  customProxyTemplate?: string
}): SandboxFetchTransport {
  if (isPrivateSandboxFetchUrl(options.request)) return 'direct'
  if (options.preferProxy && options.customProxyTemplate) return 'custom-proxy'
  return resolveSandboxFetchTransport(options.configured, options.policy)
}

export const HOST_NETWORK_TRANSPORTS = ['direct', 'wss', 'custom-proxy'] as const
export type HostNetworkTransport = (typeof HOST_NETWORK_TRANSPORTS)[number]
export type HostNetworkSelection = HostNetworkTransport | 'auto'

export function resolveHostTransport(options: {
  recommendation: HostNetworkTransport
  selection: HostNetworkSelection
  appProxyTemplate?: string
}): HostNetworkTransport {
  if (options.selection !== 'auto') return options.selection
  return options.appProxyTemplate ? 'custom-proxy' : options.recommendation
}

export function createCustomProxyFetch(template: string, hostFetch: typeof fetch): typeof fetch {
  if (!template.includes('{url}')) {
    throw new Error('Custom proxy URL must include {url} for the encoded destination.')
  }
  const example = new URL(template.replace('{url}', encodeURIComponent('https://example.invalid/')))
  if (!['http:', 'https:'].includes(example.protocol) || example.username || example.password) {
    throw new Error('Custom proxy must use an HTTP(S) URL without embedded credentials.')
  }
  return async (input, init) => {
    const request = new Request(input, init)
    const proxyUrl = template.replace('{url}', encodeURIComponent(request.url))
    return await hostFetch(new Request(proxyUrl, request))
  }
}

export type HostProviderNetwork = {
  providerId: string
  recommendation: HostNetworkTransport
  purpose?: 'chat-completion' | 'model-discovery' | 'oauth'
}

export function createHostNetwork(options: {
  directFetch: typeof fetch
  getWssFetch: (purpose: NonNullable<HostProviderNetwork['purpose']>) => typeof fetch | undefined
  getAppProxyTemplate: () => string | undefined
  getProviderProxyTemplate: (providerId: string) => string | undefined
  getProviderSelection: (providerId: string) => HostNetworkSelection | undefined
  chooseProviderSelection: (
    provider: HostProviderNetwork,
    origin: string,
  ) => Promise<HostNetworkSelection>
}) {
  const pendingChoices = new Map<string, Promise<HostNetworkSelection>>()

  const selectProviderTransport = async (provider: HostProviderNetwork, origin: string) => {
    const saved = options.getProviderSelection(provider.providerId)
    if (saved) return saved
    let pending = pendingChoices.get(provider.providerId)
    if (!pending) {
      pending = options.chooseProviderSelection(provider, origin)
      pendingChoices.set(provider.providerId, pending)
      void pending.finally(() => pendingChoices.delete(provider.providerId)).catch(() => undefined)
    }
    return await pending
  }

  const providerFetch =
    (provider: HostProviderNetwork): typeof fetch =>
    async (input, init) => {
      const request = new Request(input, init)
      const selection = await selectProviderTransport(provider, new URL(request.url).origin)
      const appProxyTemplate = options.getAppProxyTemplate()
      const transport = resolveHostTransport({
        recommendation: provider.recommendation,
        selection,
        ...(appProxyTemplate ? { appProxyTemplate } : {}),
      })
      if (transport === 'direct') return await options.directFetch(request)
      if (transport === 'wss') {
        const wssFetch = options.getWssFetch(provider.purpose ?? 'chat-completion')
        if (!wssFetch) throw new Error(`WSS is unavailable for ${provider.providerId}.`)
        return await wssFetch(request)
      }
      const template = options.getProviderProxyTemplate(provider.providerId) ?? appProxyTemplate
      if (!template) throw new Error(`No custom proxy is configured for ${provider.providerId}.`)
      return await createCustomProxyFetch(template, options.directFetch)(request)
    }

  return { providerFetch }
}
