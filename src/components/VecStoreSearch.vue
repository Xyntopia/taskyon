<template>
  <div class="column q-gutter-xs items-stretch content-stretch fit">
    <div class="text-h5">Vexvault Document Store Administration & Settings </div>
    <div class="row q-gutter-xs">
      <div class="col-6">
        <q-card>
          <q-card-section>
            <VecStoreUploader />
          </q-card-section>
        </q-card>
      </div>
      <div class="col-5">
        <q-card>
          <q-card-section>
            <VecStoreUploader />
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div>
      <q-card style="width:100%">
        <q-card-section>
          <Search @search="onSearchChange" class="fit" />
        </q-card-section>
        <q-item-section>
          <q-list dense separator padding bordered>
            <q-item>
              <q-item-section side>ID</q-item-section>
              <q-item-section>Score</q-item-section>
              <q-item-section>Document</q-item-section>
              <q-item-section>Metadata</q-item-section>
            </q-item>
            <q-item v-for="res, idx in searchResults" v-bind:key="idx">
              <q-item-section side>{{ res.document.id }}</q-item-section>
              <q-item-section>{{ (1 / (res.distance + 0.001)) }}</q-item-section>
              <q-item-section>{{ res.document.document.pageContent }}</q-item-section>
              <q-item-section>{{ res.document.document.metadata }}</q-item-section>
            </q-item>
          </q-list>
        </q-item-section>
      </q-card>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useVectorStore } from 'src/modules/localVectorStore'
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
    const searchResults = ref<unknown[]>([]);

    // Perform the search and get results
    async function performSearch(searchTerm: string) {
      const res = await vectorStore.query(searchTerm)
      return res
    }


    async function onSearchChange(searchTerm: string | Event) {
      if (searchTerm instanceof Event) { // for some reason, in chrome, a second event with the original input-event gets fired...
        return
      } else if (!searchTerm) {
        searchResults.value = []
      } else {
        // Perform your search here
        console.log(`Searching for ${searchTerm}`);
        searchResults.value = await performSearch(searchTerm)
        console.log(searchResults.value)
      }
    };
    return {
      onSearchChange,
      searchResults
    }
  }
})
</script>
