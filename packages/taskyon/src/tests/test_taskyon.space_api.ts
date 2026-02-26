import { secureFetch } from '@taskyon/secure-tunnel'
import { humanizeError } from '../utils/error'
import { getTyJwtPublicKey, mintToken, returnToken, verifyServiceToken } from '../taskyon.space/taskyon.space_api'
import { TOKEN_SERVICE_BASE_URL, TOKEN_SERVICE_PREFIX } from '../taskyon.space/tokenservice.types'
import { sleep } from '../utils/asyncUtils'
import axios from 'axios'

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

  return { token, svcTokenData, returnres }
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

  const nowSec = Math.floor(Date.now() / 1000)
  const waitSeconds = Math.max(0, verified.iat + verified.oms - nowSec + 5)
  if (!ctx.allowLongRun) {
    return {
      skipped: true,
      reason:
        'Long-running test disabled. Re-run with { tyauth, allowLongRun: true } to wait until iat+oms and validate rejection.',
      required_wait_seconds: waitSeconds,
      token_ttl_seconds: verified.exp - verified.iat,
      oms_seconds: verified.oms,
    }
  }

  await sleep(waitSeconds * 1000)

  const err = await expectThrows(
    async () =>
      await returnToken(baseUrl, token, 0.001, {
        test_name: 'testTokenReturnAfterOms',
        expectation: 'return should fail after iat+oms',
        waited_seconds: waitSeconds,
        iat: verified.iat,
        exp: verified.exp,
        oms: verified.oms,
      }),
    'Expected return to fail after iat+oms, but it succeeded',
  )

  const msg = humanizeError(err)
  return {
    success: msg.includes('Token return window exceeded'),
    waited_seconds: waitSeconds,
    token_ttl_seconds: verified.exp - verified.iat,
    oms_seconds: verified.oms,
    error: msg,
  }
}
testTokenReturnAfterOms.experimental = true

export const testSecureFetch = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  const tunnelUrl = 'wss://share.taskyon.space/ws-proxy/'

  const sfetchGet = async (url: string, tunnelToken: string) => {
    return await secureFetch(url, {
      method: 'GET',
      tunnelUrl,
      tunnelToken,
    })
  }

  // const testApiUrl1 = 'https://api.nasdaq.com/api/quote/AAPL/chart'
  const testApiUrl2 = 'https://example.com'

  const response = await sfetchGet(testApiUrl2, token)

  console.log(response.status)
  console.log(response.body)
  const data1 = response.text()
  /*const expectedString = '<!doctype html><html lang="en"><head><title>Example Domain</title>'
  if (data1.slice(0, expectedString.length) !== expectedString) {
    console.error('Not the correct string:', { data1 })
    throw new Error('We did not get the correct string...')
  }*/

  const err1 = await expectThrows(async () => await fetch(testApiUrl2))
  const expectedCorsError =
    "Success: Error while downloading 'normal' browser based fetch, but expected" +
    humanizeError(err1)

  // error should occur for no double spending with the same token.
  const err = await expectThrows(async () => await sfetchGet(testApiUrl2, token))
  const expectedDoubleSpendError =
    'This Error is expected and should occur during double spending! ' + humanizeError(err)

  await sleep(5000)
  // we have mint a new token for every request
  const data2 = (await sfetchGet(testApiUrl2, await mintToken(baseUrl, ctx.tyauth))).text()

  return {
    fetch1: data1.slice(0, 500),
    fetch2: data2.slice(0, 500),
    expectedCorsError,
    expectedError: expectedDoubleSpendError,
  }
}

export const testTyProxy = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  const tunnelUrl = 'https://share.taskyon.space/proxy'

  const proxyFetch = async (url: string, tunnelToken: string, opts?: { cacheBust?: boolean }) => {
    const urlObj = new URL(tunnelUrl)
    urlObj.searchParams.set('url', url)

    // Optionally add a cache-busting query parameter so that the *browser* URL is unique
    // and cannot be satisfied from its cache.
    if (opts?.cacheBust) {
      urlObj.searchParams.set('cb', Date.now().toString())
    }

    return await axios.get<string>(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tunnelToken}`,
        // NOTE: We deliberately do *not* send Cache-Control/Pragma here, because they
        // would trigger a CORS preflight and are not whitelisted in
        // Access-Control-Allow-Headers. Cache control for the browser is handled
        // purely via the cache-busting query parameter.
      },
    })
  }

  // const testApiUrl1 = 'https://api.nasdaq.com/api/quote/AAPL/chart'
  const testApiUrl2 = 'https://example.com'

  // --- Test 1: no browser cache interference ---
  // Use a cache-busting parameter so that the first request definitely goes to the server.
  const response1 = await proxyFetch(testApiUrl2, token, { cacheBust: true })

  console.log(response1.status)
  console.log(response1.data)
  const data1 = response1.data

  const err1 = await expectThrows(async () => await fetch(testApiUrl2), 'No CORS error received!')
  const expectedCorsError =
    "Success: Error while downloading 'normal' browser based fetch, but expected" +
    humanizeError(err1)

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
    await proxyFetch(testApiUrl2, await mintToken(baseUrl, ctx.tyauth), { cacheBust: true })
  ).data

  // --- Test 2: allow browser caching and detect if it hides double-spend errors ---
  // Now we intentionally do NOT use cache-busting. If the browser caches the first
  // successful response, the second call might be served from cache and never reach
  // the server, so no double-spend error occurs.

  const tokenForCacheTest = await mintToken(baseUrl, ctx.tyauth)

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
    fetch1: data1.slice(0, 500),
    fetch2: data2.slice(0, 500),
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

testSecureFetch.experimental = true

/*
// 1) Get the wasm file URL as a string (Vite will copy it and give you a URL).
import httpsTunnelWasmUrl from '../../../https_tunnel_wasm/pkg/https_tunnel_wasm_bg.wasm?url'

// 2) Import the JS glue as a module.
import wasmModule from '../../../https_tunnel_wasm/pkg/https_tunnel_wasm'

export const testWasmHttpsTunne = async () => {
  console.log('Loading HTTPS tunnel WASM module...')

  await wasmModule.default(httpsTunnelWasmUrl)

  // 3) Initialize the wasm module, passing the wasm URL.
  //    This mirrors your rumoca pattern:
  //    await wasmModule.default(rumocaWasmUrl)

  console.log('WASM module initialized')

  wasmModule.test_rustls_client('example.com')
  // run_https_tunnel_test('ws://localhost:8443/?host=example.com');

  return {
    success: true,
  }
}*/
