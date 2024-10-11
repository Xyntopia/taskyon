import type { Tool } from '../taskyon/tools';
import type { PythonScriptResult } from '../pyodide';
import { usePyodideWebworker } from '../taskyon/webWorkerApi';

const { asyncRunPython } = usePyodideWebworker('execute python script tool');

export const executePythonScript: Tool = {
  function: async ({ code }: { code: string }): Promise<PythonScriptResult> => {
    console.log('execute python code...');
    return await asyncRunPython(code);
  },
  description: 'Executes a Python script and returns the result.',
  longDescription: `Executes Python scripts for data processing, calculations, or library interactions, 
ideal for data analysis, machine learning tasks, or custom algorithm execution.
It's important to structure the Python code such that the desired result
is the outcome of the last expression in the script. Outcomes should be of the types String, Number, List, Dict, Set.`,
  name: 'executePythonScript',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python script code to be executed.',
      },
    },
    required: ['code'],
  },
};
