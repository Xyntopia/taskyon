// Include pako library
// this piece of code loads a compressed vocabulary for vectorization tasks...
/*import pako from 'pako';

fetch('compressed_array.b64')
    .then(response => response.text())
    .then(data => {
        let binaryData = atob(data);
        let compressedData = new Uint8Array(binaryData.split("").map(char => char.charCodeAt(0)));
        let decompressedData = pako.inflate(compressedData);
        let myArray = new Float32Array(decompressedData.buffer);
    });
*/

import type {
  PreTrainedModel,
  PreTrainedTokenizer,
} from '@xenova/transformers';

async function loadTransformers() {
  const { AutoModel, AutoTokenizer } = await import(
    /* webpackChunkName: "transformers" */
    /* webpackMode: "lazy" */
    /* webpackExports: ["getEncoding"] */
    /* webpackFetchPriority: "low" */
    '@xenova/transformers'
  );
  return {
    AutoModel,
    AutoTokenizer,
  };
}

const modelStore = {
  models: {} as Record<string, PreTrainedModel>,
  tokenizers: {} as Record<string, PreTrainedTokenizer>,
  loading: {} as Record<string, Promise<void>>,
};

export async function loadModel(modelName: string) {
  // Check if loading already in progress
  if (!modelStore.loading[modelName]) {
    modelStore.loading[modelName] = (async () => {
      console.log(`load model: ${modelName}`);
      const tf = await loadTransformers();
      modelStore.models[modelName] =
        await tf.AutoModel.from_pretrained(modelName);
    })().catch((error) => {
      console.error(`Failed to load model ${modelName}:`, error);
      throw error; // Ensure loading promise rejects on failure
    });
  }
  await modelStore.loading[modelName];
  return modelStore.models[modelName];
}

export async function loadTokenizer(modelName: string) {
  if (!modelStore.loading[modelName]) {
    modelStore.loading[modelName] = (async () => {
      console.log(`load tokenizer: ${modelName}`);
      const tf = await loadTransformers();
      modelStore.tokenizers[modelName] =
        await tf.AutoTokenizer.from_pretrained(modelName);
    })().catch((error) => {
      console.error(`Failed to load tokenizer ${modelName}:`, error);
      throw error;
    });
  }
  await modelStore.loading[modelName];
  return modelStore.tokenizers[modelName];
}
