<template>
  <div v-if="accessGranted" class="row" style="min-width: 100%">
    <div class="col row content-stretch full-height">
      <div class="col-auto col items-center">
        <div class="col-auto">
          <q-tabs dense v-model="tab" vertical :class="$q.dark.isActive ? 'text-secondary' : 'text-black'">
            <q-tab name="upload" icon="upload"><q-tooltip :delay="500">open upload window</q-tooltip></q-tab>
            <q-tab name="settings" icon="settings"><q-tooltip :delay="500">open store settings</q-tooltip></q-tab>
            <q-tab name="whitelist" icon="key"><q-tooltip :delay="500">open access whitelist</q-tooltip></q-tab>
          </q-tabs>
        </div>
        <q-separator class="q-my-xs" />
        <div class="col-auto row text-center items-center justify-center">
          <q-icon name="local_library" />:
          {{ vectorStoreState.documentCount }}
          <q-tooltip>Number of documents in the collection</q-tooltip>
        </div>
        <q-separator class="q-my-xs" />
        <div class="col-auto">
          <q-btn dense size="sm" icon="help" flat href="/admin" target="_blank" class="fit">
            <q-tooltip :delay="500">Help & Documentation</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class="col">
        <q-tab-panels v-model="tab" animated class="full-height">
          <q-tab-panel name="upload">
            <FileDropZone
              :label="`Drag & drop, or click to add files to the collection: '${vecStoreUploaderState.collectionName}'`"
              @update:model-value="storeDocs" :progress="vectorizationProgress">
            </FileDropZone>
          </q-tab-panel>
          <q-tab-panel name="settings">
            <q-input v-if="addCollection" label="Input name for new collection" outlined dense v-model="newCollectionName"
              @keyup.enter="onNewCollection(newCollectionName)">
              <template v-slot:after>
                <q-btn dense flat icon="done" @click="onNewCollection(newCollectionName)">
                  <q-tooltip :delay="500">Initializecollection.</q-tooltip>
                </q-btn>
              </template>
            </q-input>
            <q-select v-else filled dense input-debounce="0" label="Selected Collection"
              :options="vecStoreUploaderState.collectionList" v-model="vecStoreUploaderState.collectionName"
              @update:model-value="onCollectionChange">
              <!--fill-input-->
              <template v-slot:after>
                <q-btn dense flat icon="add_box" @click="addCollection = true"><q-tooltip :delay="500">Create new
                    collection.</q-tooltip></q-btn>
              </template>
            </q-select>
            <div class="text-caption">Chunks: {{ vectorStoreState.numElements }}</div>
          </q-tab-panel>
          <q-tab-panel name="whitelist">
            <div class="text-bold">Webpages who have been granted access to the document store:</div>
            <q-virtual-scroll bordered :items="uploaderState.accessWhiteList" separator v-slot="{ item, index }">
              <q-item :key="index" dense>
                <q-item-section>
                  <q-item-label>
                    {{ item }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn icon="block" unelevated dense text-color="red" @click="blockAccess(item)">
                    <q-tooltip>block access</q-tooltip></q-btn>
                </q-item-section>
              </q-item>
            </q-virtual-scroll>
          </q-tab-panel>
        </q-tab-panels>
      </div>
    </div>
  </div>
  <div v-else class="column q-gutter-sm items-center content-stretch">
    <q-btn icon="key" size="lg" outline no-caps class="col full-width" @click="grantAccess(parentUrl)">
      <div>Grant search access to:</div>
      <q-tooltip>Allow page {{ parentUrl }} to search our vector store</q-tooltip>
    </q-btn>
    <div class="col">{{ parentUrl }}</div>
  </div>
  <!--
      <q-expansion-item class="hidden" default-opened dense label="Vector Store Connection">
        <q-select disabled filled dense debounce="2000" label="Select vector store/db" :options="['Pinecone']"
          v-model="vectorCollection">
          <template v-slot:after>
            <q-icon size="lg" name="info">
              <q-tooltip>
                Currently, only pinecone is supported, stay tuned for more updates!

                <br>
                register here:
                https://www.pinecone.io/
              </q-tooltip>
            </q-icon>
          </template></q-select>
        <q-input filled dense debounce="2000" label="API Key" v-model="vecStoreUploaderState.PINECONE_API_KEY"></q-input>
        <q-input filled dense debounce="2000" label="Environment"
          v-model="vecStoreUploaderState.PINECONE_ENVIRONMENT"></q-input>
        <q-select filled dense debounce="2000" label="Select Index" :options="indexList"
          v-model="vecStoreUploaderState.PINECONE_INDEXNAME" />
        <q-select filled dense debounce="2000" label="Select Collection" :options="collectionList"
          v-model="vecStoreUploaderState.PINECONE_COLLECTIONNAME" />
      </q-expansion-item>
    -->
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { LocalStorage } from 'quasar';

/*import { open } from '@tauri-apps/api/dialog';
import { homeDir } from '@tauri-apps/api/path';
*/
import FileDropZone from 'components/FileDropzone.vue'
import { useVectorStore } from 'src/modules/localVectorStore'

//name: 'VecStoreUploader',
const vecst = useVectorStore()
const accessGranted = ref(false)
const parentUrl = ref<string>('')
const uploaderState = ref({
  accessWhiteList: [] as string[]
})
const vectorizationProgress = ref(0)
const stateName = 'uploaderState'

// persist state in browser storage
watch(
  () => uploaderState,
  (newValue /*,oldValue*/) => {
    // This function will be called every time `state` or any of its nested properties changes.
    // `newValue` is the new value of `state`, and `oldValue` is its old value.
    // You can use these values to save the entire object.

    // Save the entire object here.
    // This could be an API call, local storage update, etc.
    // For example, let's save it to local storage:
    LocalStorage.set(stateName, JSON.stringify(newValue.value));
  },
  {
    deep: true,
  } // This option makes the watcher track nested properties.
);

const storedState = LocalStorage.getItem(stateName);
if (storedState) {
  uploaderState.value = JSON.parse(
    storedState as string
  ) as typeof uploaderState.value;
}

async function storeDocs(newFiles: File[]) {
  vectorizationProgress.value = 0.01
  const numFiles = newFiles.length
  for (let i = 0; i < numFiles; i++) {
    const f = newFiles[i]
    await vecst.uploadToIndex(f, async (progress) => {
      const newProgress = (i + progress) / numFiles
      vectorizationProgress.value = Math.round(newProgress * 100) / 100
      await new Promise(r => setTimeout(r, 1)); // apparently we need this in order to get our progress window to update
      await nextTick();  // wait until next DOM update cycle to continue
    })
  }
  await new Promise(r => setTimeout(r, 5000));
  vectorizationProgress.value = 0
}

/*
function set_root_dir() {
  console.log('pick directory');
  //filePicker.value?.pickFiles()
  void open_dir().then((dir) => (writersettings.root_dir = dir));
}*/

// Perform the search and get results
async function performSearch(searchTerm: string) {
  const res = await vecst.query(searchTerm)
  return res
}

let isInIframe = true
try {
  isInIframe = window.self !== window.top;
} catch (e) {
  isInIframe = true;
}

function checkAccess() {
  /*var parentUrl = (window.location != window.parent.location)
          ? document.referrer
          : document.location.href;*/
  //document.location.ancestorOrigins[0]
  accessGranted.value = false
  if (!isInIframe) {
    accessGranted.value = true
  } else {
    try {
      parentUrl.value = document.location.ancestorOrigins[0]
    } catch {
      parentUrl.value = document.referrer
    }
    console.log('running in iframe ' + parentUrl.value)
    if (uploaderState.value.accessWhiteList.includes(parentUrl.value)) {
      accessGranted.value = true
    }
  }
}

checkAccess()

if (isInIframe) { // window is an iframe
  // Listen for messages from the parent page
  window.addEventListener('message', function (event) {
    console.log('search!')
    // Check the origin of the data!
    if (!uploaderState.value.accessWhiteList.includes(event.origin)) {
      console.log('can not grant access to: ' + event.origin)
      return
    } else if (accessGranted.value == true) {
      // Process the data
      // Assuming you're receiving a search query
      var query = event.data as string;
      void performSearch(query).then(res => {
        // Send results back to the parent page
        event.source?.postMessage(res, { targetOrigin: event.origin });
      })
    }
  }, false);
}

function onCollectionChange(inputValue: string) {
  if (inputValue.length > 0) {
    vecst.loadCollection(inputValue)
  }
}

const addCollection = ref(false)
const newCollectionName = ref<string>('')

function onNewCollection(newCollName: string) {
  console.log('create new collection with name: ' + newCollName)
  addCollection.value = false
  newCollectionName.value = ''
  vecst.loadCollection(newCollName)
}

function grantAccess(url: string) {
  accessGranted.value = true
  console.log('add to whitelist')
  if (parentUrl.value) {
    if (!uploaderState.value.accessWhiteList.includes(url)) {
      uploaderState.value.accessWhiteList.push(url)
    }
  }
}

const vecStoreUploaderState= vecst.vecStoreUploaderState
const vectorStoreState= vecst.vectorStoreState
const tab= ref<string>('upload')
function blockAccess(page: string) {
  console.log('block access to page: ' + page)
  uploaderState.value.accessWhiteList = uploaderState.value.accessWhiteList.filter(p => p !== page)
  checkAccess()
}

/*function filterFn (val: string, update) {
    update(() => {

      if (val === '') {
        filterOptions.value = stringOptions
      }
      else {
        const needle = val.toLowerCase()
        filterOptions.value = stringOptions.filter(
          v => v.toLowerCase().indexOf(needle) > -1
        )
      }
    })
  }*/


</script>
