import { loadPyodide, PyProxy, type PyodideInterface } from 'pyodide';
import { PythonScriptResult, executeScript } from './pyodide';

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

self.onmessage = async ({
  data,
}: {
  data: {
    python: string;
    id: string;
    params?: unknown[];
  };
}) => {
  // make sure loading is done
  console.log('execute python script');
  const pyodide = await getPyodide();

  let result: PythonScriptResult;
  if (data.params) {
    //execute as a function with params!
    const tmp = await executeScript(pyodide, data.python, false);
    if (tmp) {
      const func = tmp.result as (...args: unknown[]) => {
        toJs: () => unknown;
      };
      const funcres = func(...data.params).toJs();
      result = {
        stdout: tmp.stdout || '',
        result: funcres,
      };
    } else {
      result = {
        stdout: '',
        result: undefined,
      };
    }
  } else {
    result = await executeScript(pyodide, data.python);
  }

  /*
  // Don't bother yet with this line, suppose our API is built in such a way:
  const { id, python, ...context } = event.data;
  // The worker copies the context in its own "memory" (an object mapping name to values)
  for (const key of Object.keys(context)) {
    self[key] = context[key];
  }*/
  // Now is the easy part, the one that is similar to working in the main thread:
  self.postMessage({ result, id: data.id });
};
