export { testTokenMinting } from '../taskyon.space/taskyon.space_api'
import { secureFetch } from '@taskyon/secure-tunnel'
import { humanizeError } from '../utils/error'
import { mintToken } from '../taskyon.space/taskyon.space_api'
import { TOKEN_SERVICE_BASE_URL, TOKEN_SERVICE_PREFIX } from '../taskyon.space/tokenservice.types'
import { sleep } from '../utils/asyncUtils'
import axios from 'axios'

async function expectThrows(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('Expected function to throw, but it did not')
}

export const testSecureFetch = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  const tunnelUrl = 'wss://localhost:9100/ws-proxy/'

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

  const tunnelUrl = 'https://localhost:9100/proxy'

  const proxyFetch = async (url: string, tunnelToken: string) => {
    const urlObj = new URL(tunnelUrl)
    urlObj.searchParams.set('url', url)
    return await axios.get(urlObj.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tunnelToken}`,
      },
    })
  }

  // const testApiUrl1 = 'https://api.nasdaq.com/api/quote/AAPL/chart'
  const testApiUrl2 = 'https://example.com'

  const response = await proxyFetch(testApiUrl2, token)

  console.log(response.status)
  console.log(response.data())
  const data1 = response.data()
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
  const err = await expectThrows(async () => await proxyFetch(testApiUrl2, token))
  const expectedDoubleSpendError =
    'This Error is expected and should occur during double spending! ' + humanizeError(err)

  await sleep(5000)
  // we have mint a new token for every request
  const data2 = (await proxyFetch(testApiUrl2, await mintToken(baseUrl, ctx.tyauth))).data()

  return {
    fetch1: data1.slice(0, 500),
    fetch2: data2.slice(0, 500),
    expectedCorsError,
    expectedError: expectedDoubleSpendError,
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
