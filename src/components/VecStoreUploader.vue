<template>
  <div v-if="accessGranted" class="row" style="min-width: 100%">
    <div class="col row content-stretch full-height">
      <div class="col-auto">
        <q-tabs dense v-model="tab" vertical class="text-primary">
          <q-tab name="upload" icon="upload"><q-tooltip :delay="1000">open upload window</q-tooltip></q-tab>
          <q-tab name="settings" icon="settings"><q-tooltip :delay="1000">open store settings</q-tooltip></q-tab>
        </q-tabs>
      </div>
      <div class="col">
        <q-tab-panels v-model="tab" animated class="full-height">
          <q-tab-panel name="upload">
            <FileDropZone
              :label="`Drag & drop your files here, or click to select files for '${vecStoreUploaderState.collectionName}'`"
              v-model="fileList">
            </FileDropZone>
          </q-tab-panel>
          <q-tab-panel name="settings">
            <q-select filled dense debounce="2000" label="Selected Collection"
              :options="vecStoreUploaderState.collectionList" v-model="vecStoreUploaderState.collectionName"
              @new-value="createCollection" use-input>
            </q-select>
            <div class="text-caption">Chunks: {{ vectorStoreState.numElements }}</div>
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

<script lang="ts">
import { defineComponent, ref, watchEffect, watch } from 'vue'
import { LocalStorage } from 'quasar';

/*import { open } from '@tauri-apps/api/dialog';
import { homeDir } from '@tauri-apps/api/path';
*/
import FileDropZone from 'components/FileDropzone.vue'
import { useVectorStore } from 'src/modules/localVectorStore'

export default defineComponent({
  name: 'VecStoreUploader',
  components: {
    FileDropZone
  },
  setup() {
    const fileList = ref<File[]>([])
    const vecst = useVectorStore()
    const searchString = ref<string>('')
    const accessGranted = ref(false)
    const parentUrl = ref<string>('')
    const uploaderState = ref({
      accessWhiteList: [] as string[]
    })
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
    watchEffect(
      () => {
        fileList.value.forEach(f => {
          void vecst.uploadToIndex(f)
        });
      }
    )

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

    /*var parentUrl = (window.location != window.parent.location)
            ? document.referrer
            : document.location.href;*/
    //document.location.ancestorOrigins[0]
    let isInIframe = true
    try {
      isInIframe = window.self !== window.top;
    } catch (e) {
      isInIframe = true;
    }
    if (!isInIframe) {
      accessGranted.value = true
    } else {
      parentUrl.value = document.location.ancestorOrigins[0]
      console.log('running in iframe ' + parentUrl.value)
      if (uploaderState.value.accessWhiteList.includes(parentUrl.value)) {
        accessGranted.value = true
      }
    }


    if (isInIframe) { // window is an iframe
      // Listen for messages from the parent page
      window.addEventListener('message', function (event) {
        console.log('search!')
        // Check the origin of the data!
        if (!uploaderState.value.accessWhiteList.includes(event.origin)) {
          console.log('can not grant access to: ' + event.origin)
          return
        }
        if (accessGranted.value) {
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

    function createCollection(inputValue: string, doneFn: (item?: unknown, mode?: 'add' | 'add-unique' | 'toggle' | undefined) => void) {
      console.log('create new value: ' + inputValue)
      if (inputValue.length > 0) {
        if (!vecst.vecStoreUploaderState.value.collectionList.includes(inputValue)) {
          vecst.vecStoreUploaderState.value.collectionList.push(inputValue)
        }
        doneFn(inputValue, 'toggle')
      }
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


    return {
      vecStoreUploaderState: vecst.vecStoreUploaderState,
      vectorStoreState: vecst.vectorStoreState,
      tab: ref<string>('upload'),
      fileList,
      searchString,
      createCollection,
      accessGranted,
      grantAccess,
      parentUrl,
    }
  }
})
</script>
