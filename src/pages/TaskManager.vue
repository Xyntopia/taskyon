<template>
  <q-page class="q-gutter-xs q-pa-xs">
    <q-btn :percentage="syncProgress" icon="sync" @click="onUpdateSearchIndex">
      update search index {{ syncProgressString }}</q-btn
    >
    <q-table
      style="font-size: 0.8em;"
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
        {
          name: 'score',
          sortable: true,
          required: true,
          label: 'score',
          field: (row) => 1 / (row.distance + 0.001),
        },
        {
          name: 'task',
          sortable: true,
          required: true,
          label: 'task',
          field: (task: LLMTask) => task.id,
        }
      ]"
      row-key="name"
    >
      <template v-slot:top>
        <Search @search="onSearchChange" class="fit" />
        <div class="text-caption"># of tasks: {{ taskCount }}</div>
      </template>
      <template v-slot:body-cell-task="props">
        <Task
          style=" border: 1px solid"
          :task="props.row"
          class="q-pa-xs"
        />
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Search from 'components/Search.vue';
import { LLMTask } from 'src/modules/taskyon/types';
import { getTaskManager } from 'boot/taskyon';
import Task from 'src/components/Task.vue';

const searchResults = ref<LLMTask[]>([]);
const syncProgressString = ref('0/0');
const syncProgress = ref(0.0);
const taskCount = ref(0);

let taskManager: Awaited<ReturnType<typeof getTaskManager>>;
void getTaskManager().then(
  (tm) => ((taskManager = tm), (taskCount.value = taskManager.count()))
);

async function onUpdateSearchIndex() {
  if (taskManager) {
    await taskManager.syncVectorIndexWithTasks(true, (done, total) => {
      syncProgress.value = done / total;
      syncProgressString.value = `${done}/${total}`;
    });
  }
  taskCount.value = taskManager.count();
}

async function onSearchChange(searchTerm: string | Event, k: number) {
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
      const { tasks, distances } = await taskManager.vectorSearchTasks(
        searchTerm,
        k
      );
      // Add score to each task
      searchResults.value = tasks.map((task, index) => ({
        ...task,
        distance: distances[index], // Calculate score based on distance
      }));
    }
    console.log('finished search!');
    console.log(searchResults.value);
    taskCount.value = taskManager.count();
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
</script>
