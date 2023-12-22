import type { PythonScriptResult } from './pyodide';
import type { nlpWorkerResult } from './nlp.worker';

const nlpWorker = new Worker(new URL('./nlp.worker.ts', import.meta.url));

const nlpCallbacks: Record<number, (vector: number[] | undefined) => void> = {};

nlpWorker.onmessage = ({
  data,
}: {
  data: nlpWorkerResult & { id: number };
}) => {
  const { id, ...res } = data;
  const onSuccess = nlpCallbacks[id];
  delete nlpCallbacks[id];
  onSuccess(res.vector);
};

export const vectorizeText = (() => {
  let id = 0; // identify a Promise
  return (text: string, modelName: string) => {
    // the id could be generated more carefully
    id = (id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise<number[] | undefined>((onSuccess) => {
      nlpCallbacks[id] = onSuccess;
      console.log('calling nlp webworker');
      nlpWorker.postMessage({
        text,
        modelName,
        id,
      });
    });
  };
})();

const pyodideWorker = new Worker(
  new URL('./pyodide.worker.ts', import.meta.url)
);

const callbacks: Record<number, (value: PythonScriptResult) => void> = {};

pyodideWorker.onmessage = ({
  data,
}: {
  data: { result: PythonScriptResult; id: number };
}) => {
  const onSuccess = callbacks[data.id];
  delete callbacks[data.id];
  onSuccess(data.result);
};

export const asyncRunPython = (() => {
  let id = 0; // identify a Promise
  return (script: string, params?: unknown[]) => {
    // the id could be generated more carefully
    id = (id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise<PythonScriptResult>((onSuccess) => {
      callbacks[id] = onSuccess;
      console.log('calling python webworker');
      pyodideWorker.postMessage({
        python: script,
        id,
        params,
      });
    });
  };
})();

export async function extractKeywords(text: string, num: number) {
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
