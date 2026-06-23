// webWorkerApi.ts
/** We are starting the various webworkers used in taskyon here in this file...
 *
 * e.g. python, a worker to do NLP tasks etc..
 *
 */
import { createNlpWorkerApi, type NlpWorkerInterface } from './nlp.worker'
import { wrap } from 'comlink'
import { type pythonWorker } from './pyodide.worker'

let nlpWorker: NlpWorkerInterface | null = null

const canUseModuleWorkers = () =>
  typeof Worker !== 'undefined' && typeof URL !== 'undefined' && typeof import.meta.url === 'string'

export const useNlpWorker = () => {
  if (!nlpWorker) {
    nlpWorker = canUseModuleWorkers()
      ? wrap<NlpWorkerInterface>(
          new Worker(new URL('./nlp.worker.ts', import.meta.url), { type: 'module' }),
        )
      : createNlpWorkerApi()
  }

  return nlpWorker
}

let pythonWorker: pythonWorker | null = null
let pythonWorkerPromise: Promise<pythonWorker> | null = null

export function usePyodideWebworker() {
  const getPythonWorker = (): Promise<pythonWorker> => {
    if (pythonWorker) {
      return Promise.resolve(pythonWorker)
    }

    // If initialization is already in progress, return the existing promise
    if (pythonWorkerPromise) {
      return pythonWorkerPromise
    }

    console.log(`create pyodide webworker`)

    const worker = wrap<pythonWorker>(
      new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' }),
    )
    pythonWorker = worker
    pythonWorkerPromise = Promise.resolve(worker)

    return pythonWorkerPromise
  }

  const asyncRunPython = async (script: string, params?: unknown[]) => {
    //console.log('calling python webworker')
    const pythonWorker = await getPythonWorker()
    return await pythonWorker.runPythonScript(script, params)
  }

  return {
    asyncRunPython,
  }
}
