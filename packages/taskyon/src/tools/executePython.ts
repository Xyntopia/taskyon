import type { JSONSchema7 } from 'json-schema'
import { pyodideArtifactBaseUrl } from '../sandbox/sandboxAssets'
import { createTool } from '../types/toolApi'

export const executePythonScript = createTool({
  code: `(() => {
    const artifactBaseUrl = ${JSON.stringify(pyodideArtifactBaseUrl)};
    let pyodidePromise;
    const initialize = async () => {
      const evaluateAsset = async (fileName) => {
        const response = await fetch(artifactBaseUrl + fileName);
        if (!response.ok) throw new Error('Unable to load Python sandbox asset: ' + fileName);
        (0, eval)(await response.text());
      };
      await evaluateAsset('pyodide.js');
      await evaluateAsset('pyodide.asm.js');
      const lockResponse = await fetch(artifactBaseUrl + 'pyodide-lock.json');
      if (!lockResponse.ok) throw new Error('Unable to load the Python sandbox package manifest');
      const pythonGlobals = Object.create(null);
      for (const name of ['AbortController', 'AbortSignal', 'Object', 'Request', 'fetch']) {
        if (typeof globalThis[name] !== 'undefined') pythonGlobals[name] = globalThis[name];
      }
      return globalThis.loadPyodide({
        indexURL: artifactBaseUrl,
        packageBaseUrl: artifactBaseUrl,
        stdLibURL: artifactBaseUrl + 'python_stdlib.zip',
        lockFileContents: await lockResponse.json(),
        jsglobals: pythonGlobals,
      });
    };
    return async ({ code }) => {
      pyodidePromise ??= initialize();
      const pyodide = await pyodidePromise;
      let stdout = '';
      pyodide.setStdout({ batched: (line) => { stdout += line + '\\n'; } });
      await pyodide.loadPackagesFromImports(code);
      const pythonResult = await pyodide.runPythonAsync(code);
      let result = pythonResult;
      if (pythonResult && typeof pythonResult.toJs === 'function') {
        try {
          result = pythonResult.toJs({ dict_converter: Object.fromEntries });
        } finally {
          pythonResult.destroy?.();
        }
      }
      return { stdout, result };
    };
  })()`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python script code to be executed.',
      },
    },
    required: ['code'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  description: 'Executes Python through Pyodide inside a reusable isolated browser sandbox.',
  longDescription: `Executes Python scripts for data processing, calculations, or library interactions,
ideal for data analysis, machine learning tasks, or custom algorithm execution.
It's important to structure the Python code such that the desired result
is the outcome of the last expression in the script. Outcomes should be of the types String, Number, List, Dict, Set.`,
  name: 'executePythonScript',
})
