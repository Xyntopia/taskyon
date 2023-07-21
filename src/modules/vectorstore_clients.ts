/*import {
  PineconeClient,
  Vector,
  UpsertRequest,
} from '@pinecone-database/pinecone';*/
import { ref, computed, watch } from 'vue';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type { Tensor } from '@xenova/transformers';
import { loadFile, useVectorizer } from 'src/modules/loadFiles';
//import weaviate, { ConnectionParams } from 'weaviate-ts-client';
//import { WeaviateStore } from 'langchain/vectorstores/weaviate';
import { HierarchicalNSW, loadHnswlib } from 'hnswlib-wasm';
import { LocalStorage } from 'quasar';
// TODO: might be a good diea to move this into db.js
import Dexie from 'dexie';
//import { v4 as uuidv4 } from 'uuid';

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

/*
async function search() {
  // Now you can add items to the index
  index.addItems(vectors, labelIds);

  const k = 10;
  // Now you can search the index
  const result1 = index.searchKnn(vectors[10], k, undefined);

  // You can also search the index with a label filter
  const labelFilter = (label: number) => {
    return label >= 10 && label < 20;
  };
  const result2 = index.searchKnn(testVectorData.vectors[10], 10, labelFilter);
}*/

/*
import { HNSWWithDB } from 'hnsw';

async function loadIndex(numDimensions: number) {
  // With persistence
  console.log('create new index!');
  const index = await HNSWWithDB.create(16, 200, 'my-index');

  // Make some data
  const data = [
    { id: 1, vector: [1, 2, 3, 4, 5] },
    { id: 2, vector: [2, 3, 4, 5, 6] },
    { id: 3, vector: [3, 4, 5, 6, 7] },
    { id: 4, vector: [4, 5, 6, 7, 8] },
    { id: 5, vector: [5, 6, 7, 8, 9] },
  ];

  // Build the index
  await index.buildIndex(data);
  await index.saveIndex();

  // Load the index
  const index2 = await HNSWWithDB.create(16, 200, 'my-index-2');
  await index2.loadIndex();

  // Search for nearest neighbors
  const results2 = index2.searchKNN([6, 7, 8, 9, 10], 2);
  console.log(results2);

  // Delete the index
  await index2.deleteIndex();
  return index
}
*/

// Function to generate a random integer
/*function getRandomInt(): number {
  return crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
}

// Function to generate a UUID string using the random integer function or a provided number
function uuidv4str(num?: number): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = num !== undefined ? num : getRandomInt(),
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}*/

/*async function run() {
  const connectionParams: ConnectionParams = {
    scheme: 'https',
    host: 'localhost',
    apiKey: new weaviate.ApiKey('default'),
  };

  // Something wrong with the weaviate-ts-client types, so we need to disable
  const client = weaviate.client(connectionParams);

  await WeaviateStore.addVectors()

  await WeaviateStore()

  // Create a store and fill it with some texts + metadata
  await WeaviateStore.fromTexts(
    ['hello world', 'hi there', 'how are you', 'bye now'],
    [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'qux' }, { foo: 'bar' }],
    new OpenAIEmbeddings(),
    {
      client,
      indexName: 'Test',
      textKey: 'text',
      metadataKeys: ['foo'],
    }
  );
}*/

async function milvus_insert() {
  //const domain = 'http://localhost:9091'
  const domain =
    'https://in03-3f489e82f7bc25b.api.gcp-us-west1.zillizcloud.com';
  const api_key =
    '86ab136c530dea53d218d57637206bfb25db3106547b5ca2848bfade0888a6591995ff26280d3fce2686671ceefd95de70c88dd5';

  /*
  curl --request GET \
  --url https://in03-3f489e82f7bc25b.api.gcp-us-west1.zillizcloud.com/v1/vector/collections \
  --header 'accept: application/json' \
  --header 'authorization: Bearer <api-key>'
  */

  const options: AxiosRequestConfig = {
    method: 'POST',
    //url: `${domain}/api/v1/entities`,
    url: 'https://in03-3f489e82f7bc25b.api.gcp-us-west1.zillizcloud.com/v1/vector/collections',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${api_key}`,
      //'Api-Key': api_key,
      // TODO: add vectors
    },
    /*
    data: {
      vectors: vectors,
      namespace: vecStoreUploaderState.value.PINECONE_NAMESPACE,
    },*/
  };

  console.log('sending axios request');
  try {
    const response = await axios.request(options);
  } catch (error) {
    console.error(error);
  }
}

const defaultConfiguration = {
  PINECONE_API_KEY: 'unknown',
  PINECONE_ENVIRONMENT: 'unknown',
  PINECONE_INDEXNAME: '',
  PINECONE_COLLECTIONNAME: '',
  modelName: 'Xenova/all-MiniLM-L6-v2',
  PINECONE_NAMESPACE: 'doxcraft',
  BROWSER_STORE: {
    INDEXDB_NAME: 'default',
    MAX_ELEMENTS: 10000,
  },
};

const vectorStoreState = ref({
  maxElements: 0,
  numElements: 0,
  collectionList: [] as string[],
});

/*async function upsert(
  client: PineconeClient,
  vectors: Vector[],
  pineConeInfo: typeof defaultState
) {
  const index_name = pineConeInfo.PINECONE_INDEXNAME;
  const api_key = pineConeInfo.PINECONE_API_KEY;
  const environment = pineConeInfo.PINECONE_ENVIRONMENT;
  const project_id = client.projectName || '';
  console.log('upload');
  const options: AxiosRequestConfig = {
    method: 'POST',
    url: `https://${index_name}-${project_id}.svc.${environment}.pinecone.io/vectors/upsert`,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'Api-Key': api_key,
      // TODO: add vectors
    },
    data: {
      vectors: vectors,
      namespace: pineConeInfo.PINECONE_NAMESPACE,
    },
  };

  try {
    const response = await axios.request(options);
  } catch (error) {
    console.error(error);
  }
}*/

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

/*function createPineConeVecs(docvecs: [Document, Tensor][]) {
  const pineconeVecs: Vector[] = docvecs.map(([doc, vec]) => {
    const metadata = doc.metadata;
    metadata.loc = JSON.stringify(metadata.loc);
    return {
      id: uuidv4str(),
      values: vec.tolist(),
      metadata: metadata,
      /*sparseValues: {
              indices: [15, 30, 11];
              values: [0.1, 0.2, 0.3];
            } // optional sparse values
    };
  });
  return pineconeVecs;
}*/

/*
async function vectorUpsert(vectors: Vector[]) {
  /*const upsertRequest: UpsertRequest = {
    vectors: vectors,
    namespace: 'mynamespace',
  };
  const index = client.Index(vecStoreUploaderState.value.PINECONE_INDEXNAME);
  await index.upsert({ upsertRequest });
  await upsert(client, vectors);
}*/

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

const vecStoreUploaderConfigurationState = ref(defaultConfiguration);
const vecIndexName = computed(
  () =>
    vecStoreUploaderConfigurationState.value.BROWSER_STORE.INDEXDB_NAME +
    '_vecs'
);
let index: HierarchicalNSW | undefined = undefined;
//currently opened dexie db
let idb: DocumentDatabase | undefined = undefined;
//const documents: Record<string, any> = {};

const numDimensions = 384;

//TODO: reload index if name change detected
void loadIndex(
  numDimensions,
  vecIndexName.value,
  vecStoreUploaderConfigurationState.value.BROWSER_STORE.MAX_ELEMENTS
)
  .then((newindex) => {
    index = newindex;
    return newindex;
  })
  .then((newindex) => {
    console.log('load index');
    const indexLoadPromise = newindex.readIndex(
      vecIndexName.value,
      10000,
      false
    );
    idb = new DocumentDatabase(
      vecStoreUploaderConfigurationState.value.BROWSER_STORE.INDEXDB_NAME
    );
    if (index) {
      vectorStoreState.value = {
        ...vectorStoreState.value,
        maxElements: index.getMaxElements() || 0,
        numElements: index.getCurrentCount() || 0,
      };
    }
    if (indexLoadPromise != undefined) {
      indexLoadPromise
        .then(() => {
          console.log(`successfully loaded index: ${vecIndexName.value}`);
        })
        .catch((err) => {
          console.log('error');
          console.log(err);
        });
    }
  });

export const useVectorStore = () => {
  const indexList = ref<string[]>([]);
  const vec = useVectorizer();
  const statename = 'vectorUploaderState';
  console.log(`load ${statename}`);
  const storedState = LocalStorage.getItem(statename);

  if (storedState) {
    vecStoreUploaderConfigurationState.value = JSON.parse(
      storedState as string
    ) as typeof vecStoreUploaderConfigurationState.value;
  }

  // persist state in browser storage
  watch(
    () => vecStoreUploaderConfigurationState,
    (newValue /*oldValue*/) => {
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

  //computed vecStoreUploaderState()() =>

  // Create a client
  /*
    const client = new PineconeClient();

    async function initPinecone() {
      await client.init({
        apiKey: vecStoreUploaderState.value.PINECONE_API_KEY,
        environment: vecStoreUploaderState.value.PINECONE_ENVIRONMENT,
      });
      indexList.value = await client.listIndexes();
      console.log(indexList.value);
    }

    async function connectPinecone() {
      // select index
      const indexName = vecStoreUploaderState.value.PINECONE_INDEXNAME;
      if (indexName) {
        void client.Index(indexName);
        const indexDescription = await client.describeIndex({ indexName });
        console.log(indexDescription);
        collectionList.value = await client.listCollections();
        console.log(collectionList.value);
      }
    }

    void initPinecone().then(connectPinecone);
    */

  const vectorStoreType = ref('local_hnsw_idb');

  async function storeIndex() {
    if (index) {
      await index.writeIndex(vecIndexName.value);
    }
  }

  async function uploadToIndex(file: File) {
    const txt = await loadFile(file);
    //console.log(txt)
    console.log(`processing ${file.name}`);
    if (txt) {
      const output = await splitter.splitDocuments([
        new Document({
          pageContent: txt,
          metadata: {
            filename: file.name,
            source: 'doxcavator',
          },
        }),
      ]);
      //const output = await splitter.createDocuments([txt], metadatas = [{ filename: file.name }]);
      //console.log(output)
      console.log('vectorize');
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
      }

      //const labelIds = docvecs.map(([doc]) => doc.metadata['uuid'] as number);
      for (const doc of docvecs) {
        const newId = await idb?.documents.put({
          document: doc.document,
        });
        if (doc.vector && newId) {
          index?.addPoint(doc.vector, newId, false);
        }
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
      await storeIndex();
      console.log(`successfully uploaded file: ${file.name}`);
    }
  }
  async function knnQuery(searchQuery: string, k = 3) {
    if (index) {
      const vector = await vec.vectorize(
        searchQuery,
        vecStoreUploaderConfigurationState.value.modelName
      );
      const res = index.searchKnn(vector.tolist()[0], k, undefined);
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
          if (idb) {
            const doc = await idb?.documents.get(docId);
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

  return {
    vectorStoreType,
    vecStoreUploaderState: vecStoreUploaderConfigurationState,
    uploadToIndex,
    indexList,
    collectionList: vectorStoreState.value.collectionList,
    query,
  };
};
