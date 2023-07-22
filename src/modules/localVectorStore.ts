//TODO: get rod of all vue & quasar code
import { ref, watch } from 'vue';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { loadFile, useVectorizer } from 'src/modules/loadFiles';
import { HierarchicalNSW, loadHnswlib } from 'hnswlib-wasm';
import { LocalStorage } from 'quasar';
import Dexie from 'dexie';
//TODO: maybe use yarn add hnsw  (pure javascript library)
//TODO: make everything functional... no side effects etc...

async function loadIndex(
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
  index.initIndex(
    maxElements,
    m,
    efConstruction,
    randomSeed,
    false // allowReplaceDeleted
  );

  // Set efSearch parameters. This can be changed after the index is created.
  index.setEfSearch(200); // higher ef: slower, more accurate (between k & size of dataset)
  return index;
}

const defaultConfiguration = {
  modelName: 'Xenova/all-MiniLM-L6-v2',
  collectionName: 'default',
  MAX_ELEMENTS: 10000,
  collectionList: ['default'],
};

const vectorStoreState = ref({
  maxElements: 0,
  numElements: 0,
});

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

class DocumentDatabase extends Dexie {
  // Declare implicit table properties.
  // (just to inform Typescript. Instanciated by Dexie in stores() method)
  documents!: Dexie.Table<idbDocument, number>; // number = type of the primkey
  //...other tables goes here...

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      documents: 'id++, document',
      //...other tables goes here...
    });
  }
}

interface idbDocument {
  id?: number;
  document: Document;
  vector?: number[];
}

// TODO: get rid of "refs"
const vecStoreUploaderConfigurationState = ref(defaultConfiguration);

interface documentStoreType {
  index: HierarchicalNSW | undefined;
  //currently opened dexie db
  idb: DocumentDatabase | undefined;
  //const documents: Record<string, any> = {};
}

let documentStore: documentStoreType | undefined = undefined;

const numDimensions = 384;

async function loadDocumentStore(name: string): Promise<documentStoreType> {
  //TODO: reload index if name change detected
  const vecdbName = name + '_vecs';
  let newindex = await loadIndex(
    numDimensions,
    vecdbName,
    vecStoreUploaderConfigurationState.value.MAX_ELEMENTS
  );

  console.log('load index');
  try {
    await newindex.readIndex(vecdbName, 10000, false);
  } catch {
    console.log(`index ${vecdbName} coud not be reloaded`);
    newindex = await loadIndex(
      numDimensions,
      vecdbName,
      vecStoreUploaderConfigurationState.value.MAX_ELEMENTS
    );
  }

  const idb = new DocumentDatabase(name);
  console.log(`successfully loaded index: ${name}`);
  return {
    index: newindex,
    idb,
  };
}

function updateStoreState(documentStore: documentStoreType) {
  if (documentStore) {
    vectorStoreState.value = {
      ...vectorStoreState.value,
      maxElements: documentStore.index?.getMaxElements() || 0,
      numElements: documentStore.index?.getCurrentCount() || 0,
    };
  }
}

function loadCollection(collectionName: string) {
  void loadDocumentStore(collectionName).then((docstore) => {
    documentStore = docstore;
    updateStoreState(docstore);
  });
}
const statename = 'vectorStoreState';

// persist state in browser storage
watch(
  () => vecStoreUploaderConfigurationState,
  (newValue /*,oldValue*/) => {
    // This function will be called every time `state` or any of its nested properties changes.
    // `newValue` is the new value of `state`, and `oldValue` is its old value.
    // You can use these values to save the entire object.

    // Save the entire object here.
    // This could be an API call, local storage update, etc.
    // For example, let's save it to local storage:
    LocalStorage.set(statename, JSON.stringify(newValue.value));
  },
  {
    deep: true,
  } // This option makes the watcher track nested properties.
);

async function storeIndex(name: string) {
  if (documentStore?.index) {
    await documentStore.index.writeIndex(name);
  }
}

const vec = useVectorizer();

async function uploadToIndex(
  file: File,
  progressCallback: (progress: number) => Promise<void> | void
) {
  const txt = await loadFile(file);
  let maxsteps = 0;
  let steps = 0;
  //console.log(txt)
  console.log(`processing ${file.name}`);
  if (txt && documentStore) {
    const output = await splitter.splitDocuments([
      new Document({
        pageContent: txt,
        metadata: {
          filename: file.name,
          source: 'doxcavator',
        },
      }),
    ]);
    maxsteps = output.length * 2 || 1;
    //const output = await splitter.createDocuments([txt], metadatas = [{ filename: file.name }]);
    const docvecs: idbDocument[] = [];
    for (let i = 0; i < output.length; i++) {
      const doc = output[i];
      //const uuid = uuidv4()
      //doc.metadata['uuid'] = uuid.to
      docvecs.push({
        document: doc,
        vector: (
          await vec.vectorize(
            doc.pageContent,
            vecStoreUploaderConfigurationState.value.modelName
          )
        ).tolist()[0] as number[],
      });
      steps += 1;
      await progressCallback(steps / maxsteps);
    }

    //const labelIds = docvecs.map(([doc]) => doc.metadata['uuid'] as number);
    for (const doc of docvecs) {
      const newId = await documentStore.idb?.documents.put({
        document: doc.document,
      });
      if (doc.vector && newId) {
        documentStore.index?.addPoint(doc.vector, newId, false);
      }
      steps += 1;
      await progressCallback(steps / maxsteps);
    }
    /*const vecs = docvecs.map((doc) => doc.vector);
          const docs = docvecs.map((doc) => {
            return {
              document: doc.document
            }
          })*/
    //index.addPoints(vecs, labelIds, false);
    //index.addItems(vecs, false);
    //idb.documents.bulkPut([{

    //await index?.readIndex('doxcraftIndex', 10000, false);
    // await milvus_insert();
    //await vectorUpsert(pineconeVecs);
    await storeIndex(vecStoreUploaderConfigurationState.value.collectionName);
    console.log(`successfully uploaded file: ${file.name}`);
    updateStoreState(documentStore);
  }
}
async function knnQuery(searchQuery: string, k = 3) {
  if (documentStore?.index) {
    const vector = await vec.vectorize(
      searchQuery,
      vecStoreUploaderConfigurationState.value.modelName
    );
    const res = documentStore.index.searchKnn(vector.tolist()[0], k, undefined);
    // You can also search the index with a label filter
    /*const labelFilter = (label: number) => {
              return label >= 10 && label < 20;
            };
            const result2 = index.searchKnn(testVectorData.vectors[10], 10, labelFilter);*/
    return res;
  }
}

async function query(searchQuery: string): Promise<unknown[]> {
  if (searchQuery && searchQuery.length > 0) {
    const res = await knnQuery(searchQuery);
    const docs: unknown[] = [];
    if (res) {
      for (let i = 0; i < (res?.neighbors.length || 0); i++) {
        const docId = res.neighbors[i];
        const distance = res.distances[i];
        if (documentStore?.idb) {
          const doc = await documentStore.idb.documents.get(docId);
          if (doc) {
            docs.push({
              distance,
              document: doc,
            });
          }
        }
      }
    }
    return docs;
  } else {
    return [];
  }
}

// TODO: move this into the useVectorStore function
console.log(`load ${statename}`);
const storedState = LocalStorage.getItem(statename);
if (storedState) {
  vecStoreUploaderConfigurationState.value = JSON.parse(
    storedState as string
  ) as typeof vecStoreUploaderConfigurationState.value;
}

// finally, make sure we oad the correct collection
loadCollection(vecStoreUploaderConfigurationState.value.collectionName);

// make sure we reload everything as soon as we change our collection name.
watch(
  () => vecStoreUploaderConfigurationState.value.collectionName,
  (newValue /*,oldValue*/) => {
    console.log('load collection: ' + newValue);
    loadCollection(newValue);
    console.log('succesfull loaded collection: ' + newValue);
  }
);

export const useVectorStore = () => {
  return {
    vecStoreUploaderState: vecStoreUploaderConfigurationState,
    vectorStoreState,
    uploadToIndex,
    query,
  };
};
