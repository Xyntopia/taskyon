<template>
  <q-page class="q-gutter-xs q-pa-xs">
    <q-btn
      :percentage="syncProgress"
      :icon="matSync"
      @click="onUpdateSearchIndex"
    >
      update search index {{ syncProgressString }}</q-btn
    >
    <q-table
      style="font-size: 0.8em"
      wrap-cells
      title="Search Results"
      :rows="searchResults"
      :pagination="initialPagination"
      :columns="columns"
      :visible-columns="visibleColumns"
      row-key="id"
    >
      <template #no-data> No search results! </template>
      <template #top>
        <Search
          :search-string="$route.query.q?.toString()"
          :number-of-search-results="
            parseInt(route.query.k?.toString() || '10')
          "
          class="fit"
          outlined
          :is-searching="isSearching"
          :show-filter-button="false"
          color="secondary"
          @search="
            (searchTerm, k) => onSearchChange(searchTerm, k, labelString)
          "
        />
        <div class="text-caption">
          # of indexed tasks/tasks: {{ indexCount }}/{{ taskCount }}
        </div>
        <q-input
          v-model="labelString"
          class="q-pl-md"
          dense
          label="filter for labels"
        />
      </template>
      <template #body-cell-task="props">
        <td>
          <div class="row">
            <div class="column col-auto q-pt-sm q-pr-sm q-gutter-sm">
              <q-btn
                class="col-auto"
                outline
                :icon="mdiForum"
                dense
                to="chat"
                @click="setConversation(props.row.id)"
                ><q-tooltip>View entire conversation</q-tooltip></q-btn
              >
              <q-btn
                class="col-auto"
                outline
                :icon="mdiApproximatelyEqual"
                dense
                to="chat"
                @click="searchForSimilarTasks(props.row.id)"
                ><q-tooltip>Search for similar tasks!</q-tooltip></q-btn
              >
              <div class="auto">
                {{ `${(1 / (props.row.distance + 0.01)).toFixed(2)}` }}
                <q-tooltip>Search Similarity in %</q-tooltip>
              </div>
            </div>
            <Task :task="props.row" class="col q-pa-xs" />
          </div>
        </td>
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Search from 'components/SearchInput.vue';
import { TaskNode } from 'src/modules/taskyon/types';
import Task from 'components/taskyon/TaskWidget.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { matSync } from '@quasar/extras/material-icons';
import { mdiApproximatelyEqual, mdiForum } from '@quasar/extras/mdi-v6';
import { useRoute, useRouter } from 'vue-router';
import { onMounted } from 'vue';
import { watch } from 'vue';
//import { useRoute, useRouter } from 'vue-router';

// TODO:  do some search caching ;) so that we can move faster back & forth between
//        pages in the browser...

// Inside your <script setup> section
const route = useRoute();
const router = useRouter();

const state = useTaskyonStore();
const searchResults = ref<(TaskNode & { distance: number | undefined })[]>([]);
const syncProgressString = ref('0/0');
const syncProgress = ref(0.0);
const taskCount = ref<number | string>('N/A');
const indexCount = ref<number | string>('N/A');
const visibleColumns = ref(['task']);
const isSearching = ref(false);
const labelString = ref('');

const updateCounts = () => {
  void state.getTaskManager().then((tm) => {
    void tm
      .countTasks()
      .then((n) => (taskCount.value = n != undefined ? n : 'N/A'));
    void tm
      .countVecs()
      .then((n) => (indexCount.value = n != undefined ? n : 'N/A'));
  });
};

updateCounts();

async function onUpdateSearchIndex() {
  const taskManager = await state.getTaskManager();
  if (taskManager) {
    await taskManager.syncVectorIndexWithTasks(false, (done, total) => {
      syncProgress.value = done / total;
      syncProgressString.value = `${done}/${total}`;
      indexCount.value = done;
    });
    syncProgressString.value = '*done*';
  }
  updateCounts();
}

const createMangoQuery = (labelString: string) => {
  const labels = labelString.split('\n');
  return {
    selector: {
      label: {
        $elemMatch: {
          $eq: labels[0],
        },
      },
    },
  };
};

async function searchTasks(
  searchTerm: string,
  k: number,
  labelString: string | undefined,
) {
  const taskManager = await state.getTaskManager();
  //searchResults.value = await vectorStore.query(searchTerm, k)
  if (taskManager) {
    console.log('search for', searchTerm);
    isSearching.value = true;
    const result = labelString
      ? await taskManager.filteredVectorSearch(
          searchTerm,
          createMangoQuery(labelString),
          k,
        )
      : await taskManager.vectorSearchTasks(searchTerm, k);
    // Add score to each task
    searchResults.value = result.map((r) => ({
      ...r.task,
      distance: r.distance, // Calculate score based on distance
    }));
    taskCount.value = (await taskManager.countTasks()) || 'N/A';
    isSearching.value = false;
  }
}

async function onSearchChange(
  searchTerm: string | Event,
  k: number,
  labels: string,
) {
  if (searchTerm instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return;
  } else if (!searchTerm) {
    searchResults.value = [];
  } else {
    // Update the URL with the search parameter
    router.push({ query: { q: searchTerm, k, l: labels } }); // Perform your search here
    console.log(`Searching for ${searchTerm}`);
    await searchTasks(searchTerm, k, labels);
    console.log('finished search!');
    console.log(searchResults.value);
  }
}

onMounted(() => {
  if (route.query.q) {
    console.log('doing initial search!');
    searchTasks(
      route.query.q.toString(),
      parseInt(route.query.k?.toString() || '10'),
      labelString.value,
    );
  } else {
    searchResults.value = [];
  }
});

watch(route, (newRoute) => {
  if (newRoute.query.q) {
    searchTasks(
      newRoute.query.q.toString(),
      parseInt(newRoute.query.k?.toString() || '10'),
      newRoute.query.l?.toString(),
    );
  } else {
    searchResults.value = [];
  }
});

//const numberOfSearchResults = ref(5)
const initialPagination = {
  sortBy: 'distance',
  descending: false,
  //page: 2,
  rowsPerPage: 50,
  // rowsNumber: xx if getting data from a server
};

async function setConversation(taskId: string) {
  const taskManager = await state.getTaskManager();
  const leafTasks = await taskManager.findLeafTasks(taskId, (taskID) =>
    taskManager.getTask(taskID),
  );
  state.llmSettings.selectedTaskId = leafTasks[0];
}

const columns = [
  {
    name: 'id',
    label: 'id',
    field: (task: TaskNode) => task.id,
  },
  {
    name: 'task',
    //sortable: true,
    required: true,
    label: 'task',
    //field: (task: TaskNode) => JSON.stringify(task.content),
  },
  {
    name: 'distance',
    //sortable: true,
    label: 'score',
    field: (row: (typeof searchResults.value)[0]) => row.distance,
    format: (val: number) => `${(1 / (val + 0.01)).toFixed(2)}`,
  },
];
</script>
