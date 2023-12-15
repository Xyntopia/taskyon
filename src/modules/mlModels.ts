import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
  Tensor,
  mean_pooling,
} from '@xenova/transformers';
import { ref } from 'vue';

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

const state = ref({
  models: {} as Record<string, PreTrainedModel>,
  tokenizers: {} as Record<string, PreTrainedTokenizer>,
});

async function loadModel(modelName: string) {
  if (!state.value.models[modelName]) {
    console.log(`load model: ${modelName}`);
    state.value.models[modelName] = await AutoModel.from_pretrained(modelName);
  }
  return state.value.models[modelName];
}

async function loadTokenizer(modelName: string) {
  if (!state.value.tokenizers[modelName]) {
    console.log(`load tokenizer: ${modelName}`);
    state.value.tokenizers[modelName] = await AutoTokenizer.from_pretrained(
      modelName
    );
  }
  return state.value.tokenizers[modelName];
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

// Function to create chunks with overlap
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
  const allVectors = [];
  for (let i = 0; i < inputIdChunks.length; i++) {
    const chunkInputs = {
      input_ids: inputIdChunks[i],
      attention_mask: attentionMaskChunks[i],
      token_type_ids: tokenTypeChunks[i],
    };
    const res = (await model(chunkInputs)) as Record<string, Tensor>;
    const chunkVectors = mean_pooling(
      res.last_hidden_state,
      chunkInputs.attention_mask
    );
    allVectors.push(chunkVectors);
  }

  // Merge vectors, averaging in overlapping regions
  const mergedVectors = allVectors[0];
  /*for (let i = 1; i < allVectors.length; i++) {
    // Handle overlap averaging here
    // For simplicity, this example just appends vectors
    mergedVectors = mergedVectors.cat(
      [mergedVectors, allVectors[i]],
      0
    ) as Tensor;
  }*/

  // Optionally, return mean-pooled vector of the merged result
  return {
    //individualVectors: mergedVectors,
    meanPooledVector: mergedVectors, //mergedVectors.mean(0),
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
