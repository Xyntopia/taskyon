// webWorkerApi.ts
/** We are starting the NLP webworker used in Taskyon here. */
import { createNlpWorkerApi, type NlpWorkerInterface } from './nlp.worker'
import { wrap } from 'comlink'

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
