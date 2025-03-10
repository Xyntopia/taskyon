/** We are starting the various webworkers used in taskyon here in this file...
 *
 * e.g. python, a worker to do NLP tasks etc..
 *
 */

import type { NlpWorkerInterface } from './nlp.worker'
import { wrap } from 'comlink'
import { type pythonWorker } from '../pyodide.worker'

let nlpWorker: NlpWorkerInterface | null = null

export const useNlpWorker = () => {
  // we use nlpWorker as a singleton, making sure, we have only one thread running
  // on NLP tasks...
  if (!nlpWorker) {
    nlpWorker = wrap<NlpWorkerInterface>(
      new Worker(
        /* webpackChunkName: "nlpworker" */
        /* webpackModnlpWorkere: "lazy" */
        /* webpackFetchPriority: "low" */
        /* webpackIgnore: "true" */
        new URL('./nlp.worker.ts', import.meta.url),
        { type: 'module' },
      ),
    )
  }

  return nlpWorker
}

let pythonWorker: pythonWorker | null = null

export function usePyodideWebworker(name: string) {
  const getPythonWorker = () => {
    if (!pythonWorker) {
      console.log(`create pyodide webworker ${name}`)

      pythonWorker = wrap<pythonWorker>(
        new Worker(
          /* webpackChunkName: "pyodide-worker" */
          /* webpackMode: "lazy" */
          /* webpackFetchPriority: "low" */
          /* webpackIgnore: "true" */
          new URL('../pyodide.worker.ts', import.meta.url),
          { type: 'module' },
        ),
      )
    }
    return pythonWorker
  }

  const asyncRunPython = async (script: string, params?: unknown[]) => {
    console.log('calling python webworker')
    const pythonWorker = getPythonWorker()
    return await pythonWorker.runPythonScript(script, params)
  }

  // TODO: somehow initialize functions like this on webworker-side
  //       that way we don't have to re-initialize them all the time...
  async function extractKeywords(text: string, num: number) {
    const pythonScript = `
import micropip
await micropip.install('yake')
import yake

def keywordsFunc(text: str):
  kw_extractor = yake.KeywordExtractor()
  keywords = kw_extractor.extract_keywords(text)
  return keywords
keywordsFunc
  `
    const res = await asyncRunPython(pythonScript, [text])
    if (!res) {
      console.error('could not execute async python script')
      throw Error('could not execute async python script')
    }
    console.log('keyword Result: ', res)
    try {
      const allKws = res.result as [string, number][]
      const kws = allKws.map((x) => x[0]).slice(0, num)
      return kws
    } catch (error) {
      console.error('no keywords found!', error)
      return ['no keywords found']
    }
  }

  return {
    asyncRunPython,
    extractKeywords,
  }
}
