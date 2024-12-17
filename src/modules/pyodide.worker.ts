import type { PyProxy} from 'pyodide';
import { loadPyodide, type PyodideInterface } from 'pyodide'
import type { PythonScriptResult} from './pyodide';
import { executeScript } from './pyodide'
import { expose } from 'comlink'

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

  console.log('load Pyodide')
  pyodideInitPromise = loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
  }).then(async (pyodide) => {
    await pyodide.loadPackage(['micropip'])
    const micropip = pyodide.pyimport('micropip') as PyProxy & {
      install: (txt: string) => Promise<void>
    }
    await micropip.install('yake')
    pyodideEnv = pyodide
    pyodideInitPromise = null // Clear the promise after successful load
    return pyodide
  })

  return pyodideInitPromise
}

const pythonWorker = {
  async runPythonScript(script: string, params?: unknown[]) {
    const pyodide = await getPyodide()
    let result: PythonScriptResult

    if (params) {
      console.log('execute python script with params')
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
      console.log('execute python script without params')
      result = await executeScript(pyodide, script)
    }

    return result
  },
}

export type pythonWorker = typeof pythonWorker

expose(pythonWorker)
