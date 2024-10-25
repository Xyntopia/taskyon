import { loadPyodide, PyProxy, type PyodideInterface } from 'pyodide';
import { PythonScriptResult, executeScript } from './pyodide';
import { expose } from 'comlink';

//declare const self: ServiceWorkerGlobalScope

// Setup your project to serve `py-worker.js`. You should also serve
// `pyodide.js`, and all its associated `.asm.js`, `.json`,
// and `.wasm` files as well:
// importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

let pyodideEnv: PyodideInterface | undefined = undefined;

async function getPyodide() {
  console.log('load Pyodide');
  if (pyodideEnv) {
    return pyodideEnv;
  }
  pyodideEnv = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
  });
  //void pyodideEnv.loadPackage(['numpy', 'pytz']);
  await pyodideEnv.loadPackage(['micropip']);
  const micropip = pyodideEnv.pyimport('micropip') as PyProxy & {
    install: (txt: string) => Promise<void>;
  };
  await micropip.install('yake');
  return pyodideEnv;
}

const pythonWorker = {
  async runPythonScript(script: string, params?: unknown[]) {
    console.log('execute python script');
    const pyodide = await getPyodide();
    let result: PythonScriptResult;

    if (params) {
      const tmp = await executeScript(pyodide, script, false);
      if (tmp) {
        const func = tmp.result as (...args: unknown[]) => {
          toJs: () => unknown;
        };
        const funcRes = func(...params).toJs();
        result = { stdout: tmp.stdout || '', result: funcRes };
      } else {
        result = { stdout: '', result: undefined };
      }
    } else {
      result = await executeScript(pyodide, script);
    }

    return result;
  },
};

export type pythonWorker = typeof pythonWorker;

expose(pythonWorker);
