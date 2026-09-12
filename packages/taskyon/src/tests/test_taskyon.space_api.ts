import { secureFetch } from '@taskyon/secure-tunnel'
import { humanizeError } from '../utils/error'
import {
  getTyJwtPublicKey,
  getSettlementConfirmation,
  isSettlementConfirmationUnsupported,
  parseSettlementConfirmationResponse,
  createTunnelTokenProvider,
  mintToken,
  returnToken,
  verifyServiceToken,
} from '../taskyon.space/taskyon.space_api'
import {
  ConfirmationSchema,
  SETTLEMENT_JWT_TYPE,
  SettlementBodySchema,
  TOKEN_SERVICE_BASE_URL,
  TOKEN_SERVICE_PREFIX,
  type ReturnTokenRequest,
} from '../taskyon.space/tokenservice.types'
import { sleep } from '../utils/asyncUtils'
import { canUseTauriHttpPlugin, tauriHttpGetText } from '../utils/tauriHttpPlugin'
import axios from 'axios'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export const testSettlementConfirmationCompatibility = () => {
  const cnf = {
    jwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'A'.repeat(43),
    },
  }

  if (parseSettlementConfirmationResponse({}) !== undefined) {
    throw new Error('A service without a cnf field must use legacy token minting')
  }
  const parsed = parseSettlementConfirmationResponse({ cnf })
  if (parsed?.jwk.x !== cnf.jwk.x) {
    throw new Error('A valid service confirmation key was not detected')
  }
  if (!isSettlementConfirmationUnsupported(404) || !isSettlementConfirmationUnsupported(501)) {
    throw new Error('Clearly unsupported settlement-key endpoints must allow legacy mode')
  }
  if (isSettlementConfirmationUnsupported(401) || isSettlementConfirmationUnsupported(503)) {
    throw new Error('Authentication and server failures must not downgrade to legacy mode')
  }
  try {
    parseSettlementConfirmationResponse({ cnf: { jwk: { kty: 'invalid' } } })
  } catch {
    return { legacyCompatible: true, malformedKeysFailClosed: true }
  }
  throw new Error('A malformed advertised confirmation key must fail closed')
}

async function expectThrows(
  fn: () => Promise<unknown>,
  msg = 'Expected function to throw, but it did not',
): Promise<unknown> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error(msg)
}

export const testTokenMinting = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const token = await mintToken(baseUrl, ctx.tyauth)
  const publicKeyPromise = await getTyJwtPublicKey()
  const svcTokenData = await verifyServiceToken(publicKeyPromise!, token)

  await sleep(10_000)

  const credits_spent_increase = 0.0111
  const returnres = await returnToken(baseUrl, token, credits_spent_increase, {
    spending_reason: 'token minting roundtrip test',
    test_name: 'testTokenMinting',
  })

  return { tokenMinted: token.length > 0, svcTokenData, returnres }
}

export const testTokenMintClaims = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const token = await mintToken(baseUrl, ctx.tyauth)
  const publicKeyPromise = await getTyJwtPublicKey()
  const svcTokenData = await verifyServiceToken(publicKeyPromise!, token)

  if (!svcTokenData.principal_type) {
    throw new Error('Missing principal_type claim on minted token')
  }
  if (!Array.isArray(svcTokenData.allowed_models) || svcTokenData.allowed_models.length === 0) {
    throw new Error('Missing allowed_models claim on minted token')
  }
  if (!svcTokenData.auid || typeof svcTokenData.auid !== 'string') {
    throw new Error('Missing auid claim on minted token')
  }

  return {
    principal_type: svcTokenData.principal_type,
    allowed_models: svcTokenData.allowed_models,
    services: svcTokenData.services,
    has_auid: true,
  }
}

export const testInstanceBoundTokenSettlement = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const { kty, crv, x } = await exportJWK(publicKey)
  const cnf = ConfirmationSchema.parse({ jwk: { kty, crv, x } })
  const signSettlement = (body: ReturnTokenRequest) =>
    new SignJWT(SettlementBodySchema.parse(body))
      .setProtectedHeader({ alg: 'EdDSA', typ: SETTLEMENT_JWT_TYPE })
      .sign(privateKey)

  let token: string | undefined
  let settled = false
  try {
    token = await mintToken(baseUrl, ctx.tyauth, cnf)
    const issuerKey = await getTyJwtPublicKey()
    if (!issuerKey) throw new Error('Could not fetch tokenservice public key')
    const payload = await verifyServiceToken(issuerKey, token)
    if (payload.cnf?.jwk.x !== cnf.jwk.x) {
      throw new Error('Minted token does not contain the requested confirmation key')
    }

    const result = await returnToken(
      baseUrl,
      token,
      0,
      { test_name: 'testInstanceBoundTokenSettlement' },
      signSettlement,
    )
    settled = true
    return {
      success: !('error' in result),
      confirmationKeyBound: true,
      creditsSpent: 0,
    }
  } finally {
    if (token && !settled) {
      await returnToken(
        baseUrl,
        token,
        0,
        { test_name: 'testInstanceBoundTokenSettlement', cleanup: true },
        signSettlement,
      ).catch(() => undefined)
    }
  }
}

export const testTokenMintSecurity = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const mintUrl = `${baseUrl}/mint`
  const returnUrl = `${baseUrl}/return`
  const publicKeyPromise = await getTyJwtPublicKey()
  if (!publicKeyPromise) throw new Error('Could not fetch tokenservice public key')

  const assertions: Record<string, { ok: boolean; detail?: string }> = {}

  // 1) Unauthorized mint must fail.
  try {
    await axios.post(mintUrl, null, {
      headers: { Authorization: 'Bearer not-a-valid-auth-token' },
    })
    assertions.unauthorized_mint_rejected = {
      ok: false,
      detail: 'Mint succeeded unexpectedly with invalid auth.',
    }
  } catch (err) {
    assertions.unauthorized_mint_rejected = {
      ok: true,
      detail: humanizeError(err),
    }
  }

  // 2) Mint valid token and validate core claims.
  const token = await mintToken(baseUrl, ctx.tyauth)
  const verified = await verifyServiceToken(publicKeyPromise, token)
  const [headerB64, payloadB64] = token.split('.')
  const payload = JSON.parse(atob(payloadB64!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
    string,
    unknown
  >

  assertions.claims_present = {
    ok:
      Array.isArray(verified.allowed_models) &&
      verified.allowed_models.length > 0 &&
      typeof verified.principal_type === 'string' &&
      typeof verified.auid === 'string' &&
      verified.services.includes('proxy'),
  }

  assertions.token_ttl_bounds = {
    ok:
      typeof verified.iat === 'number' &&
      typeof verified.exp === 'number' &&
      verified.exp > verified.iat &&
      verified.exp - verified.iat <= 130,
    detail:
      typeof verified.iat === 'number' && typeof verified.exp === 'number'
        ? `ttl=${verified.exp - verified.iat}s`
        : 'missing iat/exp',
  }

  assertions.header_alg_is_eddsa = {
    ok: JSON.parse(atob(headerB64!.replace(/-/g, '+').replace(/_/g, '/'))).alg === 'EdDSA',
  }

  assertions.payload_has_expected_fields = {
    ok:
      payload['iss'] === 'taskyon.space' &&
      typeof payload['jti'] === 'string' &&
      typeof payload['max_costs'] === 'number',
  }

  // 3) Tampered token must fail verification.
  const tokenParts = token.split('.')
  const tamperedToken = `${tokenParts[0]}.${tokenParts[1]}.AAAA`
  try {
    await verifyServiceToken(publicKeyPromise, tamperedToken)
    assertions.tampered_token_rejected = {
      ok: false,
      detail: 'Tampered token verified unexpectedly.',
    }
  } catch (err) {
    assertions.tampered_token_rejected = {
      ok: true,
      detail: humanizeError(err),
    }
  }

  // 4) Invalid return payload (negative spent) must fail.
  try {
    await axios.post(
      returnUrl,
      {
        token,
        credits_spent_increase: -1,
      },
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )
    assertions.negative_spend_rejected = {
      ok: false,
      detail: 'Return accepted negative credits_spent_increase unexpectedly.',
    }
  } catch (err) {
    assertions.negative_spend_rejected = {
      ok: true,
      detail: humanizeError(err),
    }
  }

  // 5) First valid return succeeds.
  const firstReturn = await returnToken(baseUrl, token, 0.0001, {
    test_name: 'testTokenMintSecurity',
    reason: 'first valid return',
  })
  assertions.first_return_succeeds = {
    ok: !('error' in firstReturn),
    detail: JSON.stringify(firstReturn),
  }

  // 6) Replay/double-return with same token should fail.
  try {
    await returnToken(baseUrl, token, 0.0001, {
      test_name: 'testTokenMintSecurity',
      reason: 'double return replay attempt',
    })
    assertions.double_return_rejected = {
      ok: false,
      detail: 'Double return unexpectedly succeeded.',
    }
  } catch (err) {
    assertions.double_return_rejected = {
      ok: true,
      detail: humanizeError(err),
    }
  }

  const failed = Object.entries(assertions).filter(([, v]) => !v.ok)
  return {
    success: failed.length === 0,
    failed_checks: failed.map(([k, v]) => ({ check: k, detail: v.detail })),
    assertions,
  }
}

export const testTokenReturnAfterJwtExpButBeforeOms = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const token = await mintToken(baseUrl, ctx.tyauth)
  const publicKeyPromise = await getTyJwtPublicKey()
  if (!publicKeyPromise) throw new Error('Could not fetch tokenservice public key')

  const verified = await verifyServiceToken(publicKeyPromise, token)
  if (typeof verified.exp !== 'number' || typeof verified.iat !== 'number') {
    throw new Error('Token is missing exp/iat claims')
  }
  if (typeof verified.oms !== 'number' || verified.oms <= 0) {
    throw new Error('Token is missing valid oms claim')
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const waitSeconds = Math.max(0, verified.exp - nowSec + 5)
  if (waitSeconds > 0) {
    await sleep(waitSeconds * 1000)
  }

  const returnres = await returnToken(baseUrl, token, 0.0025, {
    test_name: 'testTokenReturnAfterJwtExpButBeforeOms',
    expectation: 'return should still succeed after exp, as long as now <= iat+oms',
    waited_seconds: waitSeconds,
    iat: verified.iat,
    exp: verified.exp,
    oms: verified.oms,
  })

  return {
    success: !('error' in returnres),
    waited_seconds: waitSeconds,
    token_ttl_seconds: verified.exp - verified.iat,
    oms_seconds: verified.oms,
    returnres,
  }
}
testTokenReturnAfterJwtExpButBeforeOms.experimental = true
testTokenReturnAfterJwtExpButBeforeOms.timeoutMs = 180_000

export const testTokenReturnAfterOms = async (
  ctx: { tyauth: string; allowLongRun?: boolean } = { tyauth: '' },
) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const token = await mintToken(baseUrl, ctx.tyauth)
  const publicKeyPromise = await getTyJwtPublicKey()
  if (!publicKeyPromise) throw new Error('Could not fetch tokenservice public key')

  const verified = await verifyServiceToken(publicKeyPromise, token)
  if (
    typeof verified.iat !== 'number' ||
    typeof verified.exp !== 'number' ||
    typeof verified.oms !== 'number'
  ) {
    throw new Error('Token is missing iat/exp/oms claims')
  }
  const iat = verified.iat
  const exp = verified.exp
  const oms = verified.oms

  const nowSec = Math.floor(Date.now() / 1000)
  const waitSeconds = Math.max(0, iat + oms - nowSec + 5)
  if (!ctx.allowLongRun) {
    return {
      skipped: true,
      reason:
        'Long-running test disabled. Re-run with { tyauth, allowLongRun: true } to wait until iat+oms and validate rejection.',
      required_wait_seconds: waitSeconds,
      token_ttl_seconds: exp - iat,
      oms_seconds: oms,
    }
  }

  await sleep(waitSeconds * 1000)

  const err = await expectThrows(
    async () =>
      await returnToken(baseUrl, token, 0.001, {
        test_name: 'testTokenReturnAfterOms',
        expectation: 'return should fail after iat+oms',
        waited_seconds: waitSeconds,
        iat,
        exp,
        oms,
      }),
    'Expected return to fail after iat+oms, but it succeeded',
  )

  const msg = humanizeError(err)
  return {
    success: msg.includes('Token return window exceeded'),
    waited_seconds: waitSeconds,
    token_ttl_seconds: exp - iat,
    oms_seconds: oms,
    error: msg,
  }
}
testTokenReturnAfterOms.experimental = true
testTokenReturnAfterOms.timeoutMs = 3_700_000

export const testSecureFetch = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const tunnelUrl = 'wss://share.taskyon.space/ws-proxy/'
  const getToken = createTunnelTokenProvider(tunnelUrl, baseUrl, ctx.tyauth)
  const nodeLoader = '@taskyon/https-tunnel-wasm/node'
  const tlsClientFactory =
    typeof window === 'undefined'
      ? await import(/* @vite-ignore */ nodeLoader).then(({ createNodeRustlsClientFactory }) =>
          createNodeRustlsClientFactory(),
        )
      : undefined

  const sfetchGet = async (url: string, tunnelToken: string) => {
    return await secureFetch(url, {
      method: 'GET',
      tunnelUrl,
      tunnelToken,
      ...(tlsClientFactory ? { tlsClientFactory } : {}),
    })
  }

  const httpsUrl = 'https://openwhyd.org/'
  const httpsDestination = { host: 'openwhyd.org', port: 443 } as const
  const httpsResponse = await sfetchGet(httpsUrl, await getToken(httpsDestination))
  if (httpsResponse.status !== 200) {
    throw new Error(`secureFetch HTTPS request returned ${httpsResponse.status}`)
  }
  const httpsBody = await httpsResponse.text()
  if (!httpsBody.toLowerCase().includes('openwhyd')) {
    throw new Error('secureFetch HTTPS response did not contain the expected Openwhyd page')
  }

  const expectedCorsError =
    typeof window === 'undefined'
      ? 'CORS enforcement check is not applicable outside a browser runtime.'
      : "Success: Error while downloading 'normal' browser based fetch, but expected" +
        humanizeError(await expectThrows(async () => await fetch(httpsUrl)))

  // error should occur for no double spending with the same token.
  const replayToken = await getToken(httpsDestination)
  await sfetchGet(httpsUrl, replayToken)
  const err = await expectThrows(async () => await sfetchGet(httpsUrl, replayToken))
  const expectedDoubleSpendError =
    'This Error is expected and should occur during double spending! ' + humanizeError(err)

  await sleep(5000)
  // we have mint a new token for every request
  const data2 = await (await sfetchGet(httpsUrl, await getToken(httpsDestination))).text()

  return {
    https: httpsBody.slice(0, 500),
    fetch2: data2.slice(0, 500),
    expectedCorsError,
    expectedError: expectedDoubleSpendError,
  }
}

type ProxyFetchOptions = {
  cacheBust?: boolean
  stripHeaders?: boolean
}

const createProxyFetchClient = (tunnelUrl: string) => {
  return async (url: string, tunnelToken: string, opts?: ProxyFetchOptions) => {
    const urlObj = new URL(tunnelUrl)
    urlObj.searchParams.set('url', url)

    if (opts?.cacheBust) {
      urlObj.searchParams.set('cb', Date.now().toString())
    }
    if (opts?.stripHeaders) {
      urlObj.searchParams.set('sH', '1')
    }

    return await axios.get<unknown>(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tunnelToken}`,
      },
    })
  }
}

const responseDataToText = (data: unknown): string => {
  if (typeof data === 'string') return data
  if (data === null || data === undefined) return ''
  try {
    return JSON.stringify(data)
  } catch {
    return Object.prototype.toString.call(data)
  }
}

const isPvgisRejectedHtml = (body: unknown): boolean =>
  /request rejected|support id|requested url was rejected/i.test(responseDataToText(body))

export const testTyProxy = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const token = await mintToken(
    baseUrl,
    ctx.tyauth,
    await getSettlementConfirmation('https://share.taskyon.space'),
  )

  const tunnelUrl = 'https://share.taskyon.space/proxy'
  const proxyFetch = createProxyFetchClient(tunnelUrl)

  // const testApiUrl1 = 'https://api.nasdaq.com/api/quote/AAPL/chart'
  const testApiUrl2 = 'https://openwhyd.org/'

  // --- Test 1: no browser cache interference ---
  // Use a cache-busting parameter so that the first request definitely goes to the server.
  const response1 = await proxyFetch(testApiUrl2, token, { cacheBust: true })

  console.log(response1.status)
  console.log(response1.data)
  const data1Text = responseDataToText(response1.data)

  let expectedCorsError: string

  if (typeof window === 'undefined') {
    expectedCorsError = 'CORS enforcement check is not applicable outside a browser runtime.'
  } else {
    const err1 = await expectThrows(async () => await fetch(testApiUrl2), 'No CORS error received!')
    expectedCorsError =
      "Success: Error while downloading 'normal' browser based fetch, but expected" +
      humanizeError(err1)
  }

  // For the no-cache test, we *expect* the server to see a second request and reject it
  // as a double-spend. The cache-buster ensures this request cannot be fulfilled purely
  // from the browser cache.
  const errDoubleSpend = await expectThrows(
    async () => await proxyFetch(testApiUrl2, token, { cacheBust: true }),
    'No double spending error received from server in no-cache scenario!',
  )
  const expectedDoubleSpendError =
    'This Error is expected and should occur during double spending! ' +
    humanizeError(errDoubleSpend)

  await sleep(5000)
  // we have to mint a new token for every request
  const data2 = (
    await proxyFetch(
      testApiUrl2,
      await mintToken(
        baseUrl,
        ctx.tyauth,
        await getSettlementConfirmation('https://share.taskyon.space'),
      ),
      { cacheBust: true },
    )
  ).data
  const data2Text = responseDataToText(data2)

  // --- Test 2: allow browser caching and detect if it hides double-spend errors ---
  // Now we intentionally do NOT use cache-busting. If the browser caches the first
  // successful response, the second call might be served from cache and never reach
  // the server, so no double-spend error occurs.

  const tokenForCacheTest = await mintToken(
    baseUrl,
    ctx.tyauth,
    await getSettlementConfirmation('https://share.taskyon.space'),
  )

  const cacheTestResponse1 = await proxyFetch(testApiUrl2, tokenForCacheTest, { cacheBust: false })

  let cachingHidDoubleSpend = false
  let cacheTestErrorDescription: string | null = null

  try {
    // Second request with the same token and identical URL. If this reaches the
    // server, it should trigger a double-spend error. If it is served from cache,
    // it will likely succeed with HTTP 200 and *no* error.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const cacheTestResponse2 = await proxyFetch(testApiUrl2, tokenForCacheTest, {
      cacheBust: false,
    })

    // If we got here, no error was thrown. That means either:
    //  - the server did not enforce double-spend, or
    //  - the browser/proxy cache served the response without contacting the server.
    // We classify this as "caching has hidden the double-spend error".
    cachingHidDoubleSpend = true
    cacheTestErrorDescription =
      'Second proxy request with same token and URL succeeded without error; ' +
      'this strongly suggests browser/proxy caching prevented the double-spend check '
  } catch (err) {
    // This is the *expected* path when caching does NOT interfere: the server sees
    // the second request and rejects it as a double-spend.
    cacheTestErrorDescription =
      'Double-spend error correctly observed even with caching allowed: ' + humanizeError(err)
  }

  return {
    // Test 1 (no-cache) outputs
    fetch1: data1Text.slice(0, 500),
    fetch2: data2Text.slice(0, 500),
    expectedCorsError,
    expectedError: expectedDoubleSpendError,

    // Test 2 (with cache allowed)
    cacheTest: {
      cachingHidDoubleSpend,
      description: cacheTestErrorDescription,
      firstStatus: cacheTestResponse1.status,
    },
  }
}

export const testTyProxyPvgisHeaderStripping = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  const tunnelUrl = 'https://share.taskyon.space/proxy'
  const proxyFetch = createProxyFetchClient(tunnelUrl)

  const pvgisUrl =
    'https://re.jrc.ec.europa.eu/api/tmy?lat=52.52&lon=13.405&outputformat=json&usehorizon=1'

  const tokenDefault = await mintToken(
    baseUrl,
    ctx.tyauth,
    await getSettlementConfirmation('https://share.taskyon.space'),
  )
  const defaultResp = await proxyFetch(pvgisUrl, tokenDefault, {
    cacheBust: true,
    stripHeaders: false,
  })
  const defaultBodyText = responseDataToText(defaultResp.data)
  const defaultRejected = isPvgisRejectedHtml(defaultBodyText)

  const tokenStripped = await mintToken(
    baseUrl,
    ctx.tyauth,
    await getSettlementConfirmation('https://share.taskyon.space'),
  )
  const strippedResp = await proxyFetch(pvgisUrl, tokenStripped, {
    cacheBust: true,
    stripHeaders: true,
  })
  const strippedBodyText = responseDataToText(strippedResp.data)
  const strippedRejected = isPvgisRejectedHtml(strippedBodyText)
  const strippedLooksJson =
    strippedBodyText.trim().startsWith('{') ||
    (typeof strippedResp.data === 'object' && strippedResp.data !== null)

  if (strippedRejected || !strippedLooksJson) {
    throw new Error(
      `strip mode failed for PVGIS. status=${strippedResp.status}, rejected=${strippedRejected}, bodyPreview=${strippedBodyText.slice(
        0,
        180,
      )}`,
    )
  }

  return {
    pvgisUrl,
    withoutStrip: {
      status: defaultResp.status,
      rejected: defaultRejected,
      bodyPreview: defaultBodyText.slice(0, 180),
    },
    withStrip: {
      status: strippedResp.status,
      rejected: strippedRejected,
      bodyPreview: strippedBodyText.slice(0, 180),
      looksJson: strippedLooksJson,
    },
    note: defaultRejected
      ? 'PVGIS rejected browser-like proxy request without strip mode; strip mode avoided rejection.'
      : 'PVGIS did not reject the non-stripped request in this run. Upstream behavior may vary.',
  }
}

testTyProxyPvgisHeaderStripping.experimental = true

export const testTauriHttpPluginHttpsFetch = async () => {
  if (!canUseTauriHttpPlugin()) {
    return {
      skipped: true,
      reason: 'Tauri HTTP plugin is not available in this runtime',
    }
  }

  const jsonUrl = 'https://jsonplaceholder.typicode.com/todos/1'
  const htmlUrl = 'https://example.com'
  let usedInsecureTlsFallback = false
  let strictTlsError: string | null = null

  const jsonRes = await tauriHttpGetText(jsonUrl)
  if (jsonRes.status < 200 || jsonRes.status >= 300) {
    throw new Error(`Plugin HTTP JSON request failed: ${jsonRes.status} ${jsonRes.statusText}`)
  }
  const json = JSON.parse(jsonRes.body) as { id?: number; title?: string; completed?: boolean }
  if (json.id !== 1 || typeof json.title !== 'string') {
    throw new Error(`Unexpected JSON payload from plugin HTTP: ${jsonRes.body.slice(0, 300)}`)
  }

  let htmlRes
  try {
    htmlRes = await tauriHttpGetText(htmlUrl)
  } catch (err) {
    strictTlsError = humanizeError(err)
    // Some environments (notably certain NSS/CA bundles) currently reject
    // example.com's certificate chain. Retry insecurely so this test still
    // validates plugin transport behavior while surfacing the trust failure.
    htmlRes = await tauriHttpGetText(htmlUrl, { insecureTls: true })
    usedInsecureTlsFallback = true
  }
  if (htmlRes.status < 200 || htmlRes.status >= 300) {
    throw new Error(`Plugin HTTP HTML request failed: ${htmlRes.status} ${htmlRes.statusText}`)
  }
  if (!htmlRes.body.includes('Example Domain')) {
    throw new Error('Plugin HTTP HTML response did not contain expected content')
  }

  return {
    jsonUrl,
    htmlUrl,
    jsonStatus: jsonRes.status,
    htmlStatus: htmlRes.status,
    title: json.title,
    htmlSample: htmlRes.body.slice(0, 120),
    usedInsecureTlsFallback,
    strictTlsError,
  }
}

testTokenMinting.requiresAuth = true
testTokenMintClaims.requiresAuth = true
testInstanceBoundTokenSettlement.requiresAuth = true
testTokenMintSecurity.requiresAuth = true
testTokenReturnAfterJwtExpButBeforeOms.requiresAuth = true
testTokenReturnAfterOms.requiresAuth = true
testSecureFetch.requiresAuth = true
testTyProxy.requiresAuth = true
