import { loadPyodide, type PyodideInterface } from 'pyodide';
import { executeScript } from './pyodide';

//declare const self: ServiceWorkerGlobalScope

// Setup your project to serve `py-worker.js`. You should also serve
// `pyodide.js`, and all its associated `.asm.js`, `.json`,
// and `.wasm` files as well:
importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

let pyodideEnv: PyodideInterface | undefined = undefined;

async function getPyodide() {
  if (pyodideEnv) {
    return pyodideEnv;
  }
  pyodideEnv = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
  });
  //void pyodideEnv.loadPackage(['numpy', 'pytz']);
  return pyodideEnv;
}

self.onmessage = async ({
  data,
}: {
  data: {
    python: string;
    id: string;
  };
}) => {
  // make sure loading is done
  const pyodide = await getPyodide();

  const result = await executeScript(pyodide, data.python);

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
