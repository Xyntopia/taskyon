import { expose } from 'comlink';
import { loadModel, loadTokenizer } from './mlModels';
import { getVector } from './nlp';

export type NlpWorkerInterface = {
  load: (modelName: string) => Promise<void>;
  vectorizeText: (
    text: string,
    modelName: string,
  ) => Promise<number[] | undefined>;
};

const nlpWorker: NlpWorkerInterface = {
  async load(modelName) {
    await loadModel(modelName);
    await loadTokenizer(modelName);
  },
  async vectorizeText(text, modelName) {
    return await getVector(text, modelName);
  },
};

expose(nlpWorker);
