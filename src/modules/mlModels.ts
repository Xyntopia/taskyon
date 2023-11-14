import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
} from '@xenova/transformers';
import { asyncLruCache } from './utils';

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

export const loadModel = asyncLruCache<PreTrainedModel>(1)(
  async (modelName: string) => {
    console.log(`load model: ${modelName}`);
    const model = await AutoModel.from_pretrained(modelName);
    return model;
  }
);

export const loadTokenizer = asyncLruCache<PreTrainedTokenizer>(1)(
  async (modelName: string) => {
    console.log(`load tokenizer: ${modelName}`);
    const tokenizer = await AutoTokenizer.from_pretrained(modelName);
    return tokenizer;
  }
);
