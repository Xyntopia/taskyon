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
          :is-searching="isSearching"
          @search="onSearchChange"
        />
        <div class="text-caption">
          # of indexed tasks/tasks: {{ indexCount }}/{{ taskCount }}
        </div>
      </template>
      <template #body-cell-task="props">
        <td>
          <div class="row items-stretch">
            <div class="col-auto">
              <q-btn
                outline
                :icon="mdiForum"
                dense
                to="chat"
                @click="setConversation(props.row.id)"
                ><q-tooltip>View entire conversation</q-tooltip></q-btn
              >
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
import Task from 'src/components/TaskWidget.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { findLeafTasks } from 'src/modules/taskyon/taskManager';
import { matSync } from '@quasar/extras/material-icons';
import { mdiForum } from '@quasar/extras/mdi-v6';
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
const visibleColumns = ref(['score']);
const isSearching = ref(false);

void state.getTaskManager().then((tm) => {
  void tm.countTasks().then((n) => (taskCount.value = n || 'N/A'));
  void tm.countVecs().then((n) => (indexCount.value = n || 'N/A'));
});

async function onUpdateSearchIndex() {
  const taskManager = await state.getTaskManager();
  if (taskManager) {
    await taskManager.syncVectorIndexWithTasks(true, (done, total) => {
      syncProgress.value = done / total;
      syncProgressString.value = `${done}/${total}`;
    });
  }
  taskCount.value = (await taskManager.countTasks()) || 'N/A';
}

async function searchTasks(searchTerm: string, k: number) {
  const taskManager = await state.getTaskManager();
  //searchResults.value = await vectorStore.query(searchTerm, k)
  if (taskManager) {
    console.log('search for', searchTerm);
    isSearching.value = true;
    const { tasks, distances } = await taskManager.vectorSearchTasks(
      searchTerm,
      k,
    );
    // Add score to each task
    searchResults.value = tasks.map((task, index) => ({
      ...task,
      distance: distances[index], // Calculate score based on distance
    }));
    taskCount.value = (await taskManager.countTasks()) || 'N/A';
    isSearching.value = false;
  }
}

async function onSearchChange(searchTerm: string | Event, k: number) {
  if (searchTerm instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return;
  } else if (!searchTerm) {
    searchResults.value = [];
  } else {
    // Update the URL with the search parameter
    router.push({ query: { q: searchTerm, k } }); // Perform your search here
    console.log(`Searching for ${searchTerm}`);
    await searchTasks(searchTerm, k);
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
  const leafTasks = await findLeafTasks(taskId, (taskID) =>
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
    name: 'distance',
    sortable: true,
    label: 'distance',
    field: (row: (typeof searchResults.value)[0]) => row.distance,
  },
  {
    name: 'task',
    sortable: true,
    required: true,
    label: 'task',
    field: (task: TaskNode) => task.id,
  },
];
</script>
