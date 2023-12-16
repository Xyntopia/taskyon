import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
  Tensor,
  mean_pooling,
  cat,
  mean,
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

async function loadModel(modelName: string) {
  if (!modelStore.models[modelName]) {
    console.log(`load model: ${modelName}`);
    modelStore.models[modelName] = await AutoModel.from_pretrained(modelName);
  }
  return modelStore.models[modelName];
}

async function loadTokenizer(modelName: string) {
  if (!modelStore.tokenizers[modelName]) {
    console.log(`load tokenizer: ${modelName}`);
    modelStore.tokenizers[modelName] = await AutoTokenizer.from_pretrained(
      modelName
    );
  }
  return modelStore.tokenizers[modelName];
}

async function smallVectorize(txt: string, modelName: string) {
  console.log('calculate vectors');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  const res = (await model(inputs)) as Record<string, Tensor>;
  const res2 = mean_pooling(res.last_hidden_state, inputs.attention_mask);
  return res2;
}

function createChunks(tensor: Tensor, chunkSize: number, overlap: number) {
  const numChunks = Math.ceil((tensor.size - overlap) / (chunkSize - overlap));
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    const startIdx = i * (chunkSize - overlap);
    const endIdx = startIdx + chunkSize;
    const slice = tensor.slice([0, 1], [startIdx, endIdx]);
    chunks.push(slice);
  }
  return chunks;
}

function mergeVectors(chunkVectors: Tensor[], overlap: number) {
  console.log('merge vectors');
  const mergedVectors: Tensor[] = [];

  const chunkLength = chunkVectors[0].dims[1];
  const firstChunk = chunkVectors[0].slice([0, 1], [0, chunkLength - overlap]);
  mergedVectors.push(firstChunk);

  for (let i = 1; i < chunkVectors.length; i++) {
    const currentChunk = chunkVectors[i];
    // For overlapping regions, calculate the mean with the previous chunk
    const previousChunk = chunkVectors[i - 1];
    const overlapPrevious = previousChunk.slice(
      [0, 1],
      [chunkLength - overlap, Infinity]
    );
    const overlapCurrent = currentChunk.slice([0, 1], [0, overlap]);
    //TODO: calculate the actual mean of the overlap
    const overlapMean = overlapPrevious; //overlapPrevious.cat([overlapCurrent], 1);

    mergedVectors.push(overlapMean);

    // Add the remaining part of the current chunk if it's not the last chunk
    if (i < chunkVectors.length - 1) {
      mergedVectors.push(
        currentChunk.slice([0, 1], [overlap, chunkLength - overlap])
      );
    } else {
      mergedVectors.push(currentChunk.slice([0, 1], [overlap, Infinity]));
    }
  }

  // Concatenate all vectors to form the final merged vector
  const finalMergedVecs = cat(mergedVectors, 1);
  return finalMergedVecs;
}

async function vectorize(
  txt: string,
  modelName: string,
  chunkSize = 512,
  overlap = 50
) {
  console.log('Calculating vectors for long text');
  const tokenizer = await loadTokenizer(modelName);

  const model = await loadModel(modelName);
  const maxChunkSize =
    (
      model as {
        config: { max_position_embeddings: number };
      }
    ).config.max_position_embeddings || chunkSize;

  // Tokenize the entire text and get the tokens
  const fullInputs = (await tokenizer(txt)) as {
    input_ids: Tensor;
    attention_mask: Tensor;
    token_type_ids: Tensor;
  };
  const { input_ids, attention_mask, token_type_ids } = fullInputs;

  // Create chunks for each tensor
  const inputIdChunks = createChunks(input_ids, maxChunkSize, overlap);
  const attentionMaskChunks = createChunks(
    attention_mask,
    maxChunkSize,
    overlap
  );
  const tokenTypeChunks = createChunks(token_type_ids, maxChunkSize, overlap);

  // Vectorize each chunk and collect vectors
  const chunkVectors: Tensor[] = [];
  for (let i = 0; i < inputIdChunks.length; i++) {
    const chunkInputs = {
      input_ids: inputIdChunks[i],
      attention_mask: attentionMaskChunks[i],
      token_type_ids: tokenTypeChunks[i],
    };
    const res = (await model(chunkInputs)) as Record<string, Tensor>;
    chunkVectors.push(res.last_hidden_state);
  }

  // Merge the chunk vectors
  const finalVector: Tensor = mergeVectors(chunkVectors, overlap);

  // Optionally, return mean-pooled vector of the merged result
  return {
    individualVectors: finalVector,
    meanPooledVector: mean(finalVector, 1),
  };
}

/*async function summarize(txt: string, modelName: string) {
  console.log('summarize');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  //const res = (await model.generate(inputs))// as Record<string, Tensor>;
}*/

export const useCachedModels = () => {
  return {
    vectorize: vectorize,
  };
};

export async function getVector(
  txt: string,
  modelName: string
): Promise<number[] | undefined> {
  const { meanPooledVector } = await vectorize(txt, modelName);
  return meanPooledVector.tolist()[0] as number[];
}
