<template>
  <q-page>
    <q-table
      wrap-cells
      title="Search Results"
      :rows="searchResults"
      :pagination="initialPagination"
      :columns="[
        {
          name: 'id',
          required: true,
          label: 'id',
          field: (task) => task.id,
        },
        /*{
          name: 'score',
          sortable: true,
          required: true,
          label: 'score',
          field: (row) => 1 / (row.distance + 0.001),
        },
        {
          name: 'document',
          sortable: true,
          required: true,
          label: 'document',
          field: (row) => row.document.document.pageContent,
        },
        {
          name: 'meta',
          sortable: true,
          required: true,
          label: 'meta',
          field: (row) => row.document.document.metadata,
        },*/
      ]"
      row-key="name"
    >
      <template v-slot:top>
        <Search @search="onSearchChange" class="fit" />
      </template>
      <template v-slot:body-cell-meta="props">
        <pre>{{ props }}</pre>
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Search from 'components/Search.vue';
import { LLMTask } from 'src/modules/types';
import { getTaskManager } from 'boot/taskyon';

let taskManager: Awaited<ReturnType<typeof getTaskManager>>;
void getTaskManager().then((tm) => (taskManager = tm));

const searchResults = ref<LLMTask[]>([]);

function onSearchChange(searchTerm: string | Event, k: number) {
  if (searchTerm instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return;
  } else if (!searchTerm) {
    searchResults.value = [];
  } else {
    // Perform your search here
    console.log(`Searching for ${searchTerm}`);
    //searchResults.value = await vectorStore.query(searchTerm, k)
    if (taskManager) {
      searchResults.value = taskManager.vectorSearchTask(searchTerm);
    }
    console.log(searchResults.value);
  }
}

//const numberOfSearchResults = ref(5)
const initialPagination = {
  sortBy: 'score',
  descending: true,
  //page: 2,
  rowsPerPage: 5,
  // rowsNumber: xx if getting data from a server
};
function resetDb() {
  console.log('resetting document store');
}
</script>
