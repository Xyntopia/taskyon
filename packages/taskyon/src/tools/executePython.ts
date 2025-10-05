import { createTool } from '../types/toolApi'
import type { PythonScriptResult } from '../utils/pyodide'
import { usePyodideWebworker } from '../utils/webWorkerApi'
import type { JSONSchema7 } from 'json-schema'

const { asyncRunPython } = usePyodideWebworker()

export const executePythonScript = createTool({
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
  function: async ({ code }): Promise<PythonScriptResult> => {
    console.log('execute python code...')
    return await asyncRunPython(code)
  },
  description: 'Executes a Python script and returns the result.',
  longDescription: `Executes Python scripts for data processing, calculations, or library interactions,
ideal for data analysis, machine learning tasks, or custom algorithm execution.
It's important to structure the Python code such that the desired result
is the outcome of the last expression in the script. Outcomes should be of the types String, Number, List, Dict, Set.`,
  name: 'executePythonScript',
})
