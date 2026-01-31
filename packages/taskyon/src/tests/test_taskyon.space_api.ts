export { testTokenMinting } from '../taskyon.space/taskyon.space_api'
export { selfTest } from '../experiments/wsProxyFetch'

import { secureFetch } from '@taskyon/secure-tunnel'

export const testSecureFetch = async () => {
  const response = await secureFetch('https://example.com', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer token123',
    },
    tunnelUrl: 'ws://localhost:8443',
  })

  console.log(response.status)
  console.log(response.body)
  const data = await response.json()

  return {
    data,
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
