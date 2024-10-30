import type { HnswlibModule } from 'hnswlib-wasm';
import { Lock, sleep } from '../utils';

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
  maxElements: number,
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
  loadIfExists = true,
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

/*we are using this below to test the library...

export async function testHNSWIndex() {
  const indexName = 'test-index';
  const MAX_ELEMENTS = 100;
  const index = await loadIndex(5, indexName, MAX_ELEMENTS);

  // Add some points to the index
  const points = [
    [0, 1, 2, 3, 4],
    [1, 2, 3, 4, 5],
    [3, 4, 5, 6, 6],
  ];
  for (let i = 0; i < points.length; i++) {
    index.addPoint(points[i]!, i, true);
  }

  // Check the initial number of elements
  const initialCount = index.getCurrentCount();
  console.log(`Initial number of elements: ${initialCount}`);

  // Get the initial list of labels
  const initialLabelList = index.getLabelList();
  console.log(`Initial label list: ${initialLabelList}`);

  // Delete an element
  const labelToDelete = 1;
  index.markDelete(labelToDelete);

  // Check the number of elements after delete
  const countAfterDelete = index.getCurrentCount();
  console.log(`Number of elements after delete: ${countAfterDelete}`);

  // Check if the number of elements decreased by 1
  console.log(
    `Number of elements decreased by 1: ${initialCount - 1 === countAfterDelete}`,
  );

  // Get the list of labels after delete
  const labelListAfterDelete = index.getLabelList();
  console.log(`Label list after delete: ${labelListAfterDelete}`);

  // Check if the deleted label is still in the list
  console.log(
    `Deleted label ${labelToDelete} is still in the list: ${labelListAfterDelete.includes(labelToDelete)}`,
  );

  // Try to get the point associated with the deleted label
  try {
    index.getPoint(labelToDelete);
    console.log(
      `Error: Should not be able to get point for deleted label ${labelToDelete}`,
    );
  } catch (error) {
    console.log(`Point for deleted label ${labelToDelete} is not accessible`);
  }

  // Check if we can detect deleted labels by trying to get the point
  const deletedLabels = initialLabelList.filter((label) => {
    try {
      index.getPoint(label);
      return false;
    } catch (error) {
      return true;
    }
  });
  console.log(`Detected deleted labels: ${deletedLabels}`);

  // Check if the detected deleted labels match the actual deleted labels
  console.log(
    `Detected deleted labels match actual deleted labels: ${deletedLabels.includes(labelToDelete)}`,
  );
}

// Call the test function
testHNSWIndex();*/
