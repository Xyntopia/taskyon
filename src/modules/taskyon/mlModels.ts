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
  models: {} as Record<string, Promise<PreTrainedModel>>,
  tokenizers: {} as Record<string, Promise<PreTrainedTokenizer>>,
};

export async function loadModel(modelName: string) {
  console.log(`load model: ${modelName}`);
  // Check if loading already in progress
  if (!modelStore.models[modelName]) {
    const tf = await loadTransformers();
    modelStore.models[modelName] = tf.AutoModel.from_pretrained(modelName);
  }
  return await modelStore.models[modelName];
}

export async function loadTokenizer(modelName: string) {
  if (!modelStore.tokenizers[modelName]) {
    const tf = await loadTransformers();
    modelStore.tokenizers[modelName] =
      tf.AutoTokenizer.from_pretrained(modelName);
  }
  return await modelStore.tokenizers[modelName];
}
