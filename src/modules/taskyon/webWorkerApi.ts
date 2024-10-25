/** We are starting the various webworkers used in taskyon here in this file...
 *
 * e.g. python, a worker to do NLP tasks etc..
 *
 */

import type { PythonScriptResult } from '../pyodide';
import type { NlpWorkerInterface } from './nlp.worker';
import { lruCache } from '../utils';
import { wrap } from 'comlink';

export const useNlpWorker = () => {
  // Wrap the NLP worker with Comlink
  const nlpWorker = wrap<NlpWorkerInterface>(
    new Worker(
      /* webpackChunkName: "nlpworker" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      new URL('./nlp.worker.ts', import.meta.url),
    ),
  );

  return {
    async vectorizeText(text: string, modelName: string) {
      return await nlpWorker.vectorizeText(text, modelName);
    },
    async loadModel(modelName: string) {
      await nlpWorker.load(modelName);
    },
  };
};

export function usePyodideWebworker(name: string) {
  const callbacks: Record<number, (value: PythonScriptResult) => void> = {};

  const getWebWorker = lruCache<Worker>(10)(() => {
    console.log(`create pyodide webworker ${name}`);

    const pyodideWorker = new Worker(
      /* webpackChunkName: "pyodide-worker" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      /* webpackIgnore: "true" */
      new URL('../pyodide.worker.ts', import.meta.url),
    );

    pyodideWorker.onmessage = ({
      data,
    }: {
      data: { result: PythonScriptResult; id: number };
    }) => {
      const onSuccess = callbacks[data.id];
      if (!onSuccess) {
        console.error('could not find callback id for pyodide worker!');
        return;
      }
      delete callbacks[data.id];
      onSuccess(data.result);
    };

    return pyodideWorker;
  });

  const asyncRunPython = (() => {
    let id = 0; // identify a Promise
    return (script: string, params?: unknown[]) => {
      // the id could be generated more carefully
      id = (id + 1) % Number.MAX_SAFE_INTEGER;
      return new Promise<PythonScriptResult>((onSuccess) => {
        callbacks[id] = onSuccess;
        console.log('calling python webworker');
        getWebWorker().postMessage({
          python: script,
          id,
          params,
        });
      });
    };
  })();

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
  `;
    const res = await asyncRunPython(pythonScript, [text]);
    if (!res) {
      console.error('could not execute async python script');
      throw Error('could not execute async python script');
    }
    console.log('keyword Result: ', res);
    try {
      const allKws = res.result as [string, number][];
      const kws = allKws.map((x) => x[0]).slice(0, num);
      return kws;
    } catch (error) {
      console.error('no keywords found!', error);
      return ['no keywords found'];
    }
  }

  return {
    asyncRunPython,
    extractKeywords,
  };
}
