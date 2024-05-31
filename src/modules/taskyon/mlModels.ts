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
  loading: {} as Record<string, boolean>,
};

async function waitForModelToLoad(modelName: string) {
  while (modelStore.loading[modelName] === false) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function loadModel(modelName: string) {
  if (modelStore.loading[modelName] === true) {
    // Model is already being loaded, wait for it to finish
    await waitForModelToLoad(modelName);
  } else {
    modelStore.loading[modelName] = true;
    try {
      console.log(`load model: ${modelName}`);
      const tf = await loadTransformers();
      modelStore.models[modelName] = await tf.AutoModel.from_pretrained(
        modelName
      );
    } finally {
      modelStore.loading[modelName] = false;
    }
  }
  return modelStore.models[modelName];
}

export async function loadTokenizer(modelName: string) {
  if (modelStore.loading[modelName] === true) {
    // Tokenizer is already being loaded, wait for it to finish
    await waitForModelToLoad(modelName);
  } else {
    modelStore.loading[modelName] = true;
    try {
      console.log(`load tokenizer: ${modelName}`);
      const tf = await loadTransformers();
      modelStore.tokenizers[modelName] = await tf.AutoTokenizer.from_pretrained(
        modelName
      );
    } finally {
      modelStore.loading[modelName] = false;
    }
  }
  return modelStore.tokenizers[modelName];
}
