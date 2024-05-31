import type { HnswlibModule } from 'hnswlib-wasm';
import { Lock, sleep } from './utils';

const numDimensions = 384;
let lib: HnswlibModule | undefined = undefined;

async function getHnswLib(): Promise<HnswlibModule> {
  if (lib) {
    return lib;
  } else {
    const { loadHnswlib } = await import(
      /* webpackChunkName: "hnswlib" */
      /* webpackMode: "lazy" */
      /* webpackExports: ["loadHnswlib"] */
      /* webpackFetchPriority: "low" */
      'hnswlib-wasm'
    );
    lib = await loadHnswlib();
    //TODO: we might need to run this off!
    lib.EmscriptenFileSystemManager.setDebugLogs(true);
    return lib;
  }
}

async function loadIndex(
  numDimensions: number,
  indexName: string,
  maxElements: number
) {
  const hnswLib = await getHnswLib();
  //check this for explanations:  https://github.com/nmslib/hnswlib/blob/master/ALGO_PARAMS.md
  const index = new hnswLib.HierarchicalNSW('cosine', numDimensions, indexName);
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

const indexLoadLock = new Lock();

export async function loadOrCreateHNSWIndex(
  vecdbName: string,
  MAX_ELEMENTS: number,
  loadIfExists = true
) {
  console.log('initialize index', vecdbName);
  // we need the lock, because somehow the wasm module has problems loading multiple webstores simultanously
  const done = await indexLoadLock.lock();
  // we need to wait before loading the next store :P 500ms seems to be a pretty safe bet. 100ms didn't work
  // there is some obscure background magic with probably resource sharing etc..  going on here.
  await sleep(1000);
  const newIndex = await loadIndex(numDimensions, vecdbName, MAX_ELEMENTS);
  if (loadIfExists) {
    const hnswLib = await getHnswLib();
    const exists =
      hnswLib.EmscriptenFileSystemManager.checkFileExists(vecdbName);
    if (exists) {
      try {
        await newIndex.readIndex(vecdbName, MAX_ELEMENTS, true);
        console.log('successfully loaded ', vecdbName);
      } catch (err) {
        console.error(`index ${vecdbName} could not be reloaded`, err);
      }
    }
  }
  done(); //release the lock to our store
  return newIndex;
}
