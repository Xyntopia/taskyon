import rumocaWasmUrl from 'rumoca/rumoca_bg.wasm?url'
import simulateModel from 'src/modules/modelica/simulateModel?raw'
import type * as WasmTypes from 'rumoca'
export type RumocaModule = typeof WasmTypes

// ---------- WASM loading ----------
export const loadWasm = async () => {
  const wasmModule = await import('rumoca')

  if (typeof wasmModule.default === 'function') {
    await wasmModule.default(rumocaWasmUrl)
  }

  if ('wasm_init' in wasmModule && typeof wasmModule.wasm_init === 'function') {
    try {
      await wasmModule.wasm_init(1)
    } catch (e) {
      console.warn('Rumoca wasm_init failed – single-threaded mode:', e)
    }
  }

  return wasmModule as RumocaModule
}

// ---------- Build iframe function code ----------
export const buildIframeCode = (compiledJs: string): string => `
(params, context)=>{
  ${compiledJs}
  ${simulateModel}
  const model = Model()
  return simulateModel(params, context, model)
}
`
