<template>
  <q-page class="q-gutter-xs q-pa-xs">
    {{ props }}
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
      :visible-columns="['task']"
      row-key="id"
    >
      <template #no-data> No search results! </template>
      <template #top>
        <Search
          :search-string="query.q || ''"
          :number-of-search-results="parseInt(query.k?.toString() || '10')"
          class="fit"
          outlined
          :is-searching="isSearching"
          :show-filter-button="false"
          color="secondary"
          @search="(q, k) => onSearchChange({ q, k })"
        />
        <div class="text-caption">
          # of indexed tasks/tasks: {{ indexCount }}/{{ taskCount }}
        </div>
        <q-input
          :model-value="query.l"
          class="q-pl-md"
          dense
          label="filter for labels"
          @update:model-value="
            (label) =>
              onSearchChange({ l: label != null ? String(label) : undefined })
          "
        />
      </template>
      <template #body-cell-task="rows">
        <td>
          <div class="row">
            <div class="column col-auto q-pt-sm q-pr-sm q-gutter-sm">
              <q-btn
                class="col-auto"
                outline
                :icon="mdiForum"
                dense
                to="chat"
                @click="setConversation(rows.row.taskId)"
                ><q-tooltip>View entire conversation</q-tooltip></q-btn
              >
              <q-btn
                class="col-auto"
                outline
                :icon="mdiApproximatelyEqual"
                dense
                to="chat"
                @click="onSearchChange({ t: rows.row.taskId })"
                ><q-tooltip>Search for similar tasks!</q-tooltip></q-btn
              >
              <div class="auto">
                {{ `${(1 / (rows.row.distance + 0.01)).toFixed(2)}` }}
                <q-tooltip>Search Similarity in %</q-tooltip>
              </div>
            </div>
            {{ rows.row.taskId }}
            <!--<Task :task="rows.row" class="col q-pa-xs" />-->
          </div>
        </td>
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import Search from 'components/SearchInput.vue';
import { TaskNode } from 'src/modules/taskyon/types';
//import Task from 'components/taskyon/TaskWidget.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { matSync } from '@quasar/extras/material-icons';
import { mdiApproximatelyEqual, mdiForum } from '@quasar/extras/mdi-v6';
import { useRouter } from 'vue-router';
import { onMounted } from 'vue';
import { QTableProps } from 'quasar';
//import { useRoute, useRouter } from 'vue-router';

// TODO:  do some search caching ;) so that we can move faster back & forth between
//        pages in the browser...

const defaultParams = {
  k: '10',
};

interface searchParams {
  l?: string; // label,
  q?: string; // searchTerm,
  k?: string; // number of search results...
  t?: string; // search for similar tasks...
}

const props = defineProps<{
  query: searchParams;
}>();

const query = computed(() => ({
  ...defaultParams,
  ...props.query,
}));

// Inside your <script setup> section
const router = useRouter();

const state = useTaskyonStore();
const searchResults = ref<{ taskId: string; distance: number }[]>([]);
const syncProgressString = ref('0/0');
const syncProgress = ref(0.0);
const taskCount = ref<number | string>('N/A');
const indexCount = ref<number | string>('N/A');
const isSearching = ref(false);

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

async function searchTasks(params: searchParams & { k: string }) {
  console.log('searching tasks:', params);
  const taskManager = await state.getTaskManager();
  //searchResults.value = await vectorStore.query(searchTerm, k)
  if (taskManager) {
    console.log('search for', params.q);
    isSearching.value = true;
    let result: {
      taskId: string;
      distance: number;
    }[] = [];
    if (params.q) {
      result = await taskManager.filteredVectorSearch(
        params.q,
        params.l ? createMangoQuery(params.l) : undefined,
        parseInt(params.k),
      );
    } else if (params.t) {
      const task = await taskManager.getTask(params.t);
      if (task) {
        result = await taskManager.searchSimilarTasks(
          task,
          params.l ? createMangoQuery(params.l) : undefined,
          parseInt(params.k),
        );
      }
    }
    // Add score to each task
    searchResults.value = result;
    taskCount.value = (await taskManager.countTasks()) || 'N/A';
    isSearching.value = false;
  }
}

async function onSearchChange(params: searchParams) {
  if (params instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return;
  } else if (!params) {
    searchResults.value = [];
  } else {
    // Update the URL with the search parameter
    const newQuery = { ...props.query, ...params };
    router.push({ query: newQuery }); // Perform your search here
    console.log(`Searching for ${params}`);
    //await searchTasks(q, k, l);
    console.log('finished search!');
    console.log(searchResults.value);
  }
}

onMounted(() => {
  if (props.query) {
    console.log('doing initial search!');
    searchTasks({ ...defaultParams, ...props.query });
  } else {
    searchResults.value = [];
  }
});

watch(props.query, (newQuery) => {
  searchTasks({ ...defaultParams, ...newQuery });
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

const columns: QTableProps['columns'] = [
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
    field: (task: TaskNode) => task,
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
