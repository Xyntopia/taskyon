<template>
  <div class="column q-gutter-xs items-stretch content-stretch fit">
    <div class="col">
      <q-card>
        <q-card-section class="row items-center q-gutter-md">
          <div class="col-auto">
            <q-icon size="128px">
              <q-img src="~assets/vexvault.svg" />
            </q-icon>
          </div>
          <div class="col text-h3 text-center">
            Vexvault Document Store Administration & Settings
          </div>
        </q-card-section>
      </q-card>
    </div>
    <div class="row q-gutter-xs items-stretch">
      <div class="col-5">
        <q-card>
          <q-card-section>
            <p class="text-h6">Some links:</p>
            <q-list dense separator bordered>
              <q-item href="https://github.com/xyntopia/vexvault#readme" target="_blank">-> Vexvault
                documentation/github</q-item>
              <q-item href="https://codepen.io/xyntopia/pen/zYMLRWN" target="_blank">-> Vexvault iFrame integration
                example</q-item>
              <q-item href="https://github.com/Xyntopia/vexvault/blob/main/tutorial_vexvault_iframe.md" target="_blank">->
                Vexvault iFrame integration tutorial</q-item>
              <q-item href="https://www.vexvault.com" target="_blank">-> Vexvault homepage</q-item>
              <q-item href="https://www.xyntopia.com" target="_blank">-> Xyntopia homepage</q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>
      <div class="col-6">
        <q-card class="fit">
          <q-card-section class="fit">
            <VecStoreUploader class="fit" />
          </q-card-section>
        </q-card>
      </div>
      <div class="col-5">
        <q-card>
          <q-card-section>
            <p class="text-h6">DB control:</p>
            <q-list dense separator bordered>
              <q-item clickable @click="resetDb">
                <q-item-section avatar>
                  <q-icon name="delete_forever" color="red">
                    <!--<q-img src="~assets/xyntopia_mono.svg" />-->
                  </q-icon>
                </q-item-section>
                <q-item-section>
                  Reset Database (not working, yet)
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div>
      <q-card style="width:100%">
        <q-card-section>
          <q-table wrap-cells title="Search Results" :rows="searchResults" :pagination="initialPagination" :columns="[
            { name: 'id', required: true, label: 'id', field: row => row.document.id, },
            { name: 'score', sortable: true, required: true, label: 'score', field: row => (1 / (row.distance + 0.001)), },
            { name: 'document', sortable: true, required: true, label: 'document', field: row => row.document.document.pageContent, },
            { name: 'meta', sortable: true, required: true, label: 'meta', field: row => row.document.document.metadata, },
          ]" row-key="name">
            <template v-slot:top>
              <Search @search="onSearchChange" class="fit" />
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useVectorStore, SearchResult } from 'src/modules/localVectorStore'
import Search from 'components/Search.vue';
import VecStoreUploader from 'components/VecStoreUploader.vue';

export default defineComponent({
  name: 'VecStoreSearch',
  components: {
    Search,
    VecStoreUploader
  },
  setup() {
    const vectorStore = useVectorStore();
    const searchResults = ref<SearchResult[]>([]);

    // Perform the search and get results
    async function performSearch(searchTerm: string, k: number) {
      const res = await vectorStore.query(searchTerm, k)
      return res
    }


    async function onSearchChange(searchTerm: string | Event, k: number) {
      if (searchTerm instanceof Event) { // for some reason, in chrome, a second event with the original input-event gets fired...
        return
      } else if (!searchTerm) {
        searchResults.value = []
      } else {
        // Perform your search here
        console.log(`Searching for ${searchTerm}`);
        searchResults.value = await performSearch(searchTerm, k)
        console.log(searchResults.value)
      }
    };
    return {
      onSearchChange,
      searchResults,
      numberOfSearchResults: ref(5),
      initialPagination: {
        sortBy: 'score',
        descending: true,
        //page: 2,
        rowsPerPage: 5
        // rowsNumber: xx if getting data from a server
      },
      resetDb: () => {
        console.log('resetting document store')
      }
    }
  }
})
</script>
