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
      :columns="[
        {
          name: 'id',
          required: true,
          label: 'id',
          field: (task: LLMTask) => task.id,
        },
        {
          name: 'score',
          sortable: true,
          required: true,
          label: 'score',
          field: (row: typeof searchResults.value) => 1 / (row.distance + 0.001),
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
      <template v-slot:no-data> No search results! </template>
      <template v-slot:top>
        <Search @search="onSearchChange" class="fit" />
        <div class="text-caption"># of tasks: {{ taskCount }}</div>
      </template>
      <template v-slot:body-cell-task="props">
        <td>
          <div class="row items-stretch">
            <div class="col-auto">
              <q-btn
                flat
                stretch
                :icon="matPlayArrow"
                dense
                @click="setConversation(props.row.id)"
                to="chat"
                ><q-tooltip>View entire conversation</q-tooltip></q-btn
              >
            </div>
            <Task
              style="border: 1px solid"
              :task="props.row"
              class="col q-pa-xs"
            />
          </div>
        </td>
      </template>
    </q-table>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Search from 'components/Search.vue';
import { LLMTask } from 'src/modules/taskyon/types';
import Task from 'src/components/Task.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { findLeafTasks } from 'src/modules/taskyon/taskManager';
import { matPlayArrow, matSync } from '@quasar/extras/material-icons';

const state = useTaskyonStore();
const searchResults = ref<(LLMTask & { distance: number })[]>([]);
const syncProgressString = ref('0/0');
const syncProgress = ref(0.0);
const taskCount = ref(0);

let taskManager: Awaited<ReturnType<typeof state.getTaskManager>>;
void state.getTaskManager().then((tm) => {
  taskManager = tm;
  taskCount.value = taskManager.count();
});

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
  rowsPerPage: 50,
  // rowsNumber: xx if getting data from a server
};

async function setConversation(taskId: string) {
  taskManager = await state.getTaskManager();
  const leafTasks = await findLeafTasks(taskId, (taskID) =>
    taskManager.getTask(taskID)
  );
  state.llmSettings.selectedTaskId = leafTasks[0];
}
</script>
