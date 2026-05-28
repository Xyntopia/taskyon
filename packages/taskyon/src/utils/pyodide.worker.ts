//pyodide.worker.ts
import { expose } from 'comlink'
import { loadPyodide, type PyodideInterface, version } from 'pyodide'
import type { PythonScriptResult } from './pyodide'
import { executeScript } from './pyodide'

//declare const self: ServiceWorkerGlobalScope

// Setup your project to serve `py-worker.js`. You should also serve
// `pyodide.js`, and all its associated `.asm.js`, `.json`,
// and `.wasm` files as well:
// importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

let pyodideEnv: PyodideInterface | undefined = undefined
let pyodideInitPromise: Promise<PyodideInterface> | null = null

async function getPyodide() {
  if (pyodideEnv) return pyodideEnv
  if (pyodideInitPromise) return pyodideInitPromise // Return ongoing initialization promise

  const startTime = performance.now()
  const cdnUrl = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
  const pyodideUrl = '/assets/pyodide'
  console.log('load Pyodide', version)
  const pyodide = await loadPyodide({
    // load pyodide from the specified URL here:
    // we currently copy pyodide into the assets/pyodide directory on vite build...
    indexURL: pyodideUrl,
    // we still use this here for "outside" packages...
    packageBaseUrl: cdnUrl,
  })

  console.log(`Pyodide code loaded after ${(performance.now() - startTime).toFixed(2)} ms`)
  await pyodide.loadPackage(['micropip'])
  const micropip = pyodide.pyimport('micropip')
  // TODO: instead of python use a js/wasm keyword extractor
  await micropip.install('yake==0.6.0')
  pyodideEnv = pyodide
  pyodideInitPromise = null // Clear the promise after successful load
  console.log(`Pyodide initialization took ${(performance.now() - startTime).toFixed(2)} ms`)
  return pyodide
}

const pythonWorker = {
  runPythonScript: async (script: string, params?: unknown[]) => {
    const pyodide = await getPyodide()
    let result: PythonScriptResult

    if (params) {
      //console.log('execute python script with params')
      const tmp = await executeScript(pyodide, script, false)
      if (tmp) {
        const func = tmp.result as (...args: unknown[]) => {
          toJs: () => unknown
        }
        const funcRes = func(...params).toJs()
        result = { stdout: tmp.stdout || '', result: funcRes }
      } else {
        result = { stdout: '', result: undefined }
      }
    } else {
      //console.log('execute python script without params')
      result = await executeScript(pyodide, script)
    }

    return result
  },
}

export type pythonWorker = typeof pythonWorker

if (typeof self !== 'undefined' && typeof (self as { addEventListener?: unknown }).addEventListener === 'function') {
  expose(pythonWorker)
}
