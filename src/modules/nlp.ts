import { loadTokenizer, loadModel } from './mlModels';
import { Tensor, cat, mean } from '@xenova/transformers';

export async function getVector(
  txt: string,
  modelName: string
): Promise<number[] | undefined> {
  const { meanPooledVector } = await vectorize(txt, modelName);
  return meanPooledVector.tolist()[0] as number[];
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
    const overlapTensor = cat([overlapPrevious, overlapCurrent], 0);
    const overlapMean = mean(overlapTensor, 0).unsqueeze(0); //overlapPrevious.cat([overlapCurrent], 1);

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

export async function vectorize(
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
  let inputIdChunks: Tensor[];
  let attentionMaskChunks: Tensor[];
  let tokenTypeChunks: Tensor[];
  if (input_ids.size >= maxChunkSize) {
    inputIdChunks = createChunks(input_ids, maxChunkSize, overlap);
    attentionMaskChunks = createChunks(attention_mask, maxChunkSize, overlap);
    tokenTypeChunks = createChunks(token_type_ids, maxChunkSize, overlap);
  } else {
    inputIdChunks = [input_ids];
    attentionMaskChunks = [attention_mask];
    tokenTypeChunks = [token_type_ids];
  }

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
  let finalVector: Tensor;
  if (chunkVectors.length > 1) {
    finalVector = mergeVectors(chunkVectors, overlap);
  } else {
    finalVector = chunkVectors[0];
  }

  const meanPooledVector = mean(finalVector, 1);

  // Optionally, return mean-pooled vector of the merged result
  return {
    individualVectors: finalVector,
    meanPooledVector,
  };
}
/*async function summarize(txt: string, modelName: string) {
  console.log('summarize');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  //const res = (await model.generate(inputs))// as Record<string, Tensor>;
}*/

export function tokenVecsToWordVecs(tokens: string[], vectors: Tensor[]) {
  const wordVectors: Tensor[] = [];
  const words: string[] = [];
  let currentWordVector: Tensor[] = [];
  let currentWordTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const vector = vectors[i];

    // Check if the token is a continuation of the previous one
    if (token.startsWith('##')) {
      currentWordTokens.push(token.slice(2));
      currentWordVector.push(vector);
    } else {
      // Process the previous word
      if (currentWordVector) {
        const meanVector = mean(cat(currentWordVector, 0), 0).unsqueeze(0);
        wordVectors.push(meanVector);
      }

      // Start a new word
      currentWordTokens = [token];
      currentWordVector = [vector];
    }
  }

  // Process the last word
  if (currentWordVector) {
    const meanVector = mean(cat(currentWordVector, 0), 0).unsqueeze(0);
    wordVectors.push(meanVector);
  }

  return {
    words,
    wordVectors,
  };
}

export const useCachedModels = () => {
  return {
    vectorize: vectorize,
  };
};
