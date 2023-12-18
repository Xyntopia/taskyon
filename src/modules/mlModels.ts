import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
} from '@xenova/transformers';

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

const modelStore = {
  models: {} as Record<string, PreTrainedModel>,
  tokenizers: {} as Record<string, PreTrainedTokenizer>,
};

export async function loadModel(modelName: string) {
  if (!modelStore.models[modelName]) {
    console.log(`load model: ${modelName}`);
    modelStore.models[modelName] = await AutoModel.from_pretrained(modelName);
  }
  return modelStore.models[modelName];
}

export async function loadTokenizer(modelName: string) {
  if (!modelStore.tokenizers[modelName]) {
    console.log(`load tokenizer: ${modelName}`);
    modelStore.tokenizers[modelName] = await AutoTokenizer.from_pretrained(
      modelName
    );
  }
  return modelStore.tokenizers[modelName];
}
