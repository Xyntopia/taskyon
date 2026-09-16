import { SecureFetchError, secureFetch } from '@taskyon/secure-tunnel'
import { isHostedBrowserProviderRuntime, sanitizeProviderRequestHeaders } from '../providerFetch'
import {
  createTaskyonDirectFallbackRequester,
  startTaskyonDirectFallbackHost,
} from '../directFallbackProtocol'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testSecureFetchReportsPreSendTokenFailure = async () => {
  let failure: unknown
  try {
    await secureFetch('https://provider.example/chat', {
      tunnelUrl: 'wss://tunnel.example/ws',
      getTunnelToken: () => Promise.reject(new Error('synthetic token failure')),
    })
  } catch (error) {
    failure = error
  }
  assert(failure instanceof SecureFetchError, 'Expected a typed secure-fetch failure')
  assert(failure.phase === 'token', 'Expected token minting to identify its failure phase')
  assert(failure.requestSent === false, 'Expected token failure before request transmission')
  return { success: true }
}

testSecureFetchReportsPreSendTokenFailure.description =
  'Marks token failures as safe for an explicitly approved direct retry.'

export const testProviderWssHeadersHideBrowserOrigin = () => {
  const headers = sanitizeProviderRequestHeaders({
    Authorization: 'Bearer synthetic-provider-token',
    Origin: 'https://joulios.example',
    Referer: 'https://joulios.example/private/project',
    'Sec-Fetch-Site': 'cross-site',
    'HTTP-Referer': 'https://taskyon.space',
  })
  assert(!headers.has('origin'), 'Expected WSS provider request to omit Origin')
  assert(!headers.has('referer'), 'Expected WSS provider request to omit Referer')
  assert(!headers.has('sec-fetch-site'), 'Expected WSS provider request to omit browser context')
  assert(headers.has('authorization'), 'Expected provider authorization to remain inside TLS')
  assert(
    headers.get('HTTP-Referer') === 'https://taskyon.space',
    'Expected explicit provider attribution to remain distinct from browser Referer',
  )
  return { success: true }
}

testProviderWssHeadersHideBrowserOrigin.description =
  'Removes the hosting page origin from tunneled provider requests without dropping provider credentials.'

export const testHostedBrowserProviderRuntimeExcludesLocalAndDesktopHosts = () => {
  assert(
    isHostedBrowserProviderRuntime({ hostname: 'joulios.example', isTauri: false }),
    'Expected a deployed webpage to use hosted-browser defaults',
  )
  for (const hostname of ['localhost', '127.0.0.1', '::1', 'app.localhost']) {
    assert(
      !isHostedBrowserProviderRuntime({ hostname, isTauri: false }),
      `Expected ${hostname} to use local defaults`,
    )
  }
  assert(
    !isHostedBrowserProviderRuntime({ hostname: 'joulios.example', isTauri: true }),
    'Expected Tauri to use local defaults',
  )
  return { success: true }
}

testHostedBrowserProviderRuntimeExcludesLocalAndDesktopHosts.description =
  'Uses WSS-by-default only for deployed browser hosts, never localhost or Tauri.'

export const testDirectFallbackProtocolReturnsExplicitHostConsent = async () => {
  const channel = new MessageChannel()
  const receivedOrigins: string[] = []
  const stopHost = startTaskyonDirectFallbackHost(channel.port1, (request) => {
    receivedOrigins.push(request.origin)
    return Promise.resolve(request.failurePhase === 'connect')
  })
  const requester = createTaskyonDirectFallbackRequester(channel.port2)
  try {
    const approved = await requester.request({
      origin: 'https://provider.example',
      requestKind: 'chat-completion',
      failurePhase: 'connect',
    })
    assert(approved, 'Expected the host consent response to reach the worker')
    assert(
      receivedOrigins[0] === 'https://provider.example',
      'Expected the consent boundary to expose only the provider origin',
    )
  } finally {
    requester.destroy()
    stopHost()
  }
  return { success: true }
}

testDirectFallbackProtocolReturnsExplicitHostConsent.description =
  'Carries phase-safe direct-fallback consent across the local browser worker boundary.'
