export { testTokenMinting } from '../taskyon.space/taskyon.space_api'
import { secureFetch } from '@taskyon/secure-tunnel'
import { humanizeError } from '../utils/error'
import { mintToken } from '../taskyon.space/taskyon.space_api'
import { TOKEN_SERVICE_BASE_URL, TOKEN_SERVICE_PREFIX } from '../taskyon.space/tokenservice.types'

export const testSecureFetch = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX

  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  const tunnelUrl = 'wss://localhost:9100/ws-proxy/'

  const sfetch = async (url: string, opts: Record<string, string>) => {
    return await secureFetch(url, {
      method: 'GET',
      tunnelToken: token,
      tunnelUrl,
      ...opts,
    })
  }

  const response = await sfetch('https://example.com', { method: 'GET' })

  console.log(response.status)
  console.log(response.body)
  const data = response.text()

  const weatherURl = 'https://officeapi.dev/api/quotes/random'
  let res: unknown
  try {
    const resp = await fetch(weatherURl)
    res = await resp.json()
  } catch (err) {
    res =
      "Success: Error while downloading 'normal' browser based fetch, but expected" +
      humanizeError(err)
  }

  const daresp = await sfetch(weatherURl, { method: 'GET' })
  const weather = daresp.json()

  return {
    res,
    data,
    weather,
  }
}

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
