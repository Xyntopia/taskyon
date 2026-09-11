import { readFile } from 'node:fs/promises'
import init, { TlsClient } from '../pkg/https_tunnel_wasm.js'
import type { RustlsClientFactory } from './index'

export async function createNodeRustlsClientFactory(): Promise<RustlsClientFactory> {
  const wasm = await readFile(new URL('../pkg/https_tunnel_wasm_bg.wasm', import.meta.url))
  await init({ module_or_path: wasm })
  return (host) => Promise.resolve().then(() => new TlsClient(host))
}
