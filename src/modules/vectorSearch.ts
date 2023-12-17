import { HierarchicalNSW, loadHnswlib } from 'hnswlib-wasm';

export async function loadIndex(
  numDimensions: number,
  indexName: string,
  maxElements: number
) {
  //check this for explanations:  https://github.com/nmslib/hnswlib/blob/master/ALGO_PARAMS.md
  const lib = await loadHnswlib();
  const index = new lib.HierarchicalNSW('cosine', numDimensions, indexName);
  // Initialize the index with the dimensions (1536), m, efConstruction. See the section below on parameters for more details. These cannot be changed after the index is created.
  // m: max number of outgoing connections in graph, memory consumption, roughly: (M * 8-10)*numDataPoints,
  // also low m is better if we have low intrinsic dimension of dataset and  low recall is OK.
  const m = 30;
  // bigger efConstruction: higher quality index, longer construction
  const efConstruction = 200;
  const randomSeed = 111;
  index.initIndex(maxElements, m, efConstruction, randomSeed, true);

  // Set efSearch parameters. This can be changed after the index is created.
  index.setEfSearch(200); // higher ef: slower, more accurate (between k & size of dataset)
  return index;
}
const numDimensions = 384;

export async function loadOrCreateVectorStore(
  vecdbName: string,
  MAX_ELEMENTS: number,
  loadIfExists = true
) {
  console.log('initialize index', vecdbName);
  if (loadIfExists) {
    try {
      const newindex = await loadIndex(numDimensions, vecdbName, MAX_ELEMENTS);
      await newindex.readIndex(vecdbName, MAX_ELEMENTS, true);
      return newindex;
    } catch {
      console.log(`index ${vecdbName} could not be reloaded`);
    }
  }
  const newindex = await loadIndex(numDimensions, vecdbName, MAX_ELEMENTS);
  return newindex;
}
