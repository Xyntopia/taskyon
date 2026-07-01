import type * as TransformersRuntimeModule from '@huggingface/transformers'
import type { Tensor, PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'
import {
  DEFAULT_KEYWORD_STOP_WORDS,
  textRankTerms,
  type RankedTextTerm,
  type TextRankOptions,
} from './textRank'

export { DEFAULT_KEYWORD_STOP_WORDS, textRankTerms }
export type { RankedTextTerm, TextRankOptions }

type TransformersRuntime = typeof TransformersRuntimeModule

let transformersRuntime: Promise<TransformersRuntime> | undefined

async function loadTransformersRuntime() {
  transformersRuntime ??= import('@huggingface/transformers').then((runtime) => {
    runtime.env.allowLocalModels = false
    runtime.env.allowRemoteModels = true
    return runtime
  })
  return transformersRuntime
}
//env.
//env.localModelPath = '/path/to/local/models/';
//env.cacheDir = '/path/to/cache/directory/';

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

/*async function loadTransformers() {
  const { AutoModel, AutoTokenizer } = await import(
    /* webpackChunkName: "transformers" */
/* webpackMode: "lazy" */
/* webpackExports: ["getEncoding"] */
/* webpackFetchPriority: "low" *
    '@huggingface/transformers'
  );
  return {
    AutoModel,
    AutoTokenizer,
  };
}*/

const modelStore = {
  models: {} as Record<string, Promise<PreTrainedModel>>,
  tokenizers: {} as Record<string, Promise<PreTrainedTokenizer>>,
}

const vectorMagnitude = (values: number[]): number =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))

const tokenIdsToTokens = (tokenizer: PreTrainedTokenizer, tokenIds: number[]): string[] =>
  tokenIds.map((id) => tokenizer._tokenizer.id_to_token(id) ?? '')

export async function loadModel(modelName: string) {
  console.log(`load model: ${modelName}`)
  // Check if loading already in progress
  if (!modelStore.models[modelName]) {
    //const tf = await loadTransformers();
    modelStore.models[modelName] = loadTransformersRuntime().then(({ AutoModel }) =>
      AutoModel.from_pretrained(modelName),
    )
  }
  return await modelStore.models[modelName]
}

export async function loadTokenizer(modelName: string) {
  if (!modelStore.tokenizers[modelName]) {
    //const tf = await loadTransformers();
    modelStore.tokenizers[modelName] = loadTransformersRuntime().then(({ AutoTokenizer }) =>
      AutoTokenizer.from_pretrained(modelName),
    )
  }
  return await modelStore.tokenizers[modelName]
}

export async function getVector(txt: string, modelName: string): Promise<number[]> {
  const { meanPooledVector } = await vectorize(txt, modelName)
  const newVec = meanPooledVector.tolist()[0]
  if (newVec && newVec.length > 0) return newVec as number[]
  else throw new Error('no vector found')
}

function createChunks(tensor: Tensor, chunkSize: number, overlap: number) {
  const numChunks = Math.ceil((tensor.size - overlap) / (chunkSize - overlap))
  const chunks = []
  for (let i = 0; i < numChunks; i++) {
    const startIdx = i * (chunkSize - overlap)
    const endIdx = startIdx + chunkSize
    const slice = tensor.slice([0, 1], [startIdx, endIdx])
    chunks.push(slice)
  }
  return chunks
}

function mergeVectors(
  chunkVectors: Tensor[],
  overlap: number,
  tensorOps: Pick<TransformersRuntime, 'cat' | 'mean'>,
) {
  console.log('merge vectors')
  const { cat, mean } = tensorOps
  const mergedVectors: Tensor[] = []

  const chunkLength = chunkVectors[0]!.dims[1]!
  const firstChunk = chunkVectors[0]!.slice([0, 1], [0, chunkLength - overlap])
  mergedVectors.push(firstChunk)

  for (let i = 1; i < chunkVectors.length; i++) {
    const currentChunk = chunkVectors[i]!
    // For overlapping regions, calculate the mean with the previous chunk
    const previousChunk = chunkVectors[i - 1]!
    const overlapPrevious = previousChunk.slice([0, 1], [chunkLength - overlap, Infinity])
    const overlapCurrent = currentChunk.slice([0, 1], [0, overlap])
    const overlapTensor = cat([overlapPrevious, overlapCurrent], 0)
    const overlapMean = mean(overlapTensor, 0).unsqueeze(0) //overlapPrevious.cat([overlapCurrent], 1);

    mergedVectors.push(overlapMean)

    // Add the remaining part of the current chunk if it's not the last chunk
    if (i < chunkVectors.length - 1) {
      mergedVectors.push(currentChunk.slice([0, 1], [overlap, chunkLength - overlap]))
    } else {
      mergedVectors.push(currentChunk.slice([0, 1], [overlap, Infinity]))
    }
  }

  // Concatenate all vectors to form the final merged vector
  const finalMergedVecs = cat(mergedVectors, 1)
  return finalMergedVecs
}

export async function vectorize(txt: string, modelName: string, chunkSize = 512, overlap = 50) {
  console.log('Calculating vectors for long text')
  const tensorOps = await loadTransformersRuntime()
  const { mean } = tensorOps
  const tokenizer = await loadTokenizer(modelName)
  const model = await loadModel(modelName)
  const maxChunkSize =
    (
      model as {
        config: { max_position_embeddings: number }
      }
    ).config.max_position_embeddings || chunkSize

  // Tokenize the entire text and get the tokens
  const fullInputs = (await tokenizer(txt)) as {
    input_ids: Tensor
    attention_mask: Tensor
    token_type_ids: Tensor
  }
  const { input_ids, attention_mask, token_type_ids } = fullInputs

  // Create chunks for each tensor
  let inputIdChunks: Tensor[]
  let attentionMaskChunks: Tensor[]
  let tokenTypeChunks: Tensor[]
  if (input_ids.size >= maxChunkSize) {
    inputIdChunks = createChunks(input_ids, maxChunkSize, overlap)
    attentionMaskChunks = createChunks(attention_mask, maxChunkSize, overlap)
    tokenTypeChunks = createChunks(token_type_ids, maxChunkSize, overlap)
  } else {
    inputIdChunks = [input_ids]
    attentionMaskChunks = [attention_mask]
    tokenTypeChunks = [token_type_ids]
  }

  // Vectorize each chunk and collect vectors
  const chunkVectors: Tensor[] = []
  for (let i = 0; i < inputIdChunks.length; i++) {
    const chunkInputs = {
      input_ids: inputIdChunks[i],
      attention_mask: attentionMaskChunks[i],
      token_type_ids: tokenTypeChunks[i],
    }
    const res = (await model(chunkInputs)) as Record<string, Tensor>
    if (!res.last_hidden_state) throw new Error('no last_hidden_state detected!')
    chunkVectors.push(res.last_hidden_state)
  }

  // Merge the chunk vectors
  let finalVector: Tensor | undefined
  if (chunkVectors.length > 1) {
    finalVector = mergeVectors(chunkVectors, overlap, tensorOps)
  } else {
    finalVector = chunkVectors[0]
  }

  if (!finalVector) throw new Error('no hidden states were found!!')

  const meanPooledVector = mean(finalVector, 1)

  // Optionally, return mean-pooled vector of the merged result
  return {
    token_ids: input_ids,
    individualVectors: finalVector,
    meanPooledVector,
  }
}
/*async function summarize(txt: string, modelName: string) {
    console.log('summarize');
    const tokenizer = await loadTokenizer(modelName);
    const model = await loadModel(modelName);
    const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
    //const res = (await model.generate(inputs))// as Record<string, Tensor>;
  }*/

export function tokenVecsToWordVecs(
  tokens: string[],
  vectors: Tensor,
  meanTensor: TransformersRuntime['mean'],
) {
  const wordVectors: Tensor[] = []
  const words: string[] = []
  let currentWordStartIndex = 0

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!

    // Check if the token is a continuation of the previous one
    if (token.startsWith('##')) {
      continue
    } else {
      // Process the previous word
      const tokenNum = i - currentWordStartIndex
      if (tokenNum > 1) {
        let meanVector = vectors.slice([currentWordStartIndex, i])
        meanVector = meanTensor(meanVector, 0)
        wordVectors.push(meanVector)
      } else {
        wordVectors.push(vectors.slice(currentWordStartIndex))
      }

      const nextWord = tokens
        .slice(currentWordStartIndex, i)
        .map((t) => t.replace('##', ''))
        .join('')
      words.push(nextWord)
      // Start a new word
      currentWordStartIndex = i
    }
  }

  let meanVector = vectors.slice([currentWordStartIndex, tokens.length])
  meanVector = meanTensor(meanVector, 0)
  wordVectors.push(meanVector)
  const nextWord = tokens
    .slice(currentWordStartIndex, tokens.length)
    .map((t) => t.replace('##', ''))
    .join('')
  words.push(nextWord)

  return {
    words,
    wordVectors,
  }
}

export const useCachedModels = () => {
  return {
    vectorize: vectorize,
  }
}

export async function extractKeywords(
  txt: string,
  modelName: string,
  numKeywords = 5, // Default number of keywords to extract
) {
  console.log('extract keywords!')
  //console.log('language detected:', lang);

  //const detectedLanguage = await browser.i18n.detectLanguage(txt);
  //const languageCode = detectedLanguage.languages[0].language; // Assuming the most probable language is the first one

  // First, we vectorize the text to get word vectors and the mean vector for the entire string
  const { cat, cos_sim, mean } = await loadTransformersRuntime()
  const { individualVectors, token_ids } = await vectorize(txt, modelName)

  // Tokenize the text to get individual words
  const tokenizer = await loadTokenizer(modelName)
  const tokens = tokenIdsToTokens(tokenizer, token_ids.flatten().tolist())
  const { words, wordVectors } = tokenVecsToWordVecs(tokens, individualVectors.squeeze(0), mean)

  // remove all stop words from text

  // Calculate cosine similarity for each word
  // filter out words with "longest" vectors which
  // are more significant
  const filteredWordVecs = wordVectors.map((v, i) => {
    return [words[i], vectorMagnitude(v.tolist())]
  })
  filteredWordVecs.sort((a, b) => (b[1] as number) - (a[1] as number))
  const meanVecList = mean(cat(wordVectors, 0), 0).tolist()
  const cosineSimilarities = wordVectors.map((vector) => cos_sim(meanVecList[0], vector.tolist()))

  // Pair words with their cosine similarities
  const wordSimilarities = words.map((word, index) => ({
    word,
    similarity: cosineSimilarities[index],
  }))

  // Sort words by their similarity to the mean vector
  wordSimilarities.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))

  // Filter out stopwords and select top N keywords
  const keywords = wordSimilarities
    .filter(({ word }) => !DEFAULT_KEYWORD_STOP_WORDS.includes(word.toLowerCase()))
    .slice(0, numKeywords)
    .map(({ word }) => word)

  return keywords
}

export function extractTextRankKeywords(
  txt: string,
  options: TextRankOptions = {},
): RankedTextTerm[] {
  return textRankTerms(txt, options)
}

export async function extractCombinedKeywords(
  txt: string,
  options: {
    modelName?: string
    maxTerms?: number
    vectorWeight?: number
    textRankOptions?: TextRankOptions
  } = {},
) {
  const maxTerms = Math.max(1, options.maxTerms ?? 5)
  const vectorWeight = options.vectorWeight ?? 0.5
  const textRankWeight = 1 - vectorWeight
  const textRankKeywords = extractTextRankKeywords(txt, {
    ...options.textRankOptions,
    maxTerms,
  })

  if (!options.modelName) {
    return textRankKeywords.map((term) => term.display)
  }

  const vectorKeywords = await extractKeywords(txt, options.modelName, maxTerms)
  const combined = new Map<string, { display: string; score: number; firstIndex: number }>()
  for (const [index, keyword] of vectorKeywords.entries()) {
    const term = keyword.toLowerCase()
    combined.set(term, {
      display: keyword,
      score: vectorWeight * (maxTerms - index),
      firstIndex: index,
    })
  }
  for (const term of textRankKeywords) {
    const current = combined.get(term.term)
    combined.set(term.term, {
      display: current?.display ?? term.display,
      score: (current?.score ?? 0) + textRankWeight * term.score,
      firstIndex: Math.min(current?.firstIndex ?? term.firstIndex, term.firstIndex),
    })
  }

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex)
    .slice(0, maxTerms)
    .map((entry) => entry.display)
}
