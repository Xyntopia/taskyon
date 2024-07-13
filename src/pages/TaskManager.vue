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
          field: (row: typeof searchResults.value) =>
            1 / (row.distance + 0.001),
        },
        {
          name: 'task',
          sortable: true,
          required: true,
          label: 'task',
          field: (task: LLMTask) => task.id,
        },
      ]"
      row-key="name"
    >
      <template #no-data> No search results! </template>
      <template #top>
        <Search class="fit" @search="onSearchChange" />
        <div class="text-caption">
          # of indexed tasks/tasks: {{ indexCount }}/{{ taskCount }}
        </div>
      </template>
      <template #body-cell-task="props">
        <td>
          <div class="row items-stretch">
            <div class="col-auto">
              <q-btn
                flat
                stretch
                :icon="matPlayArrow"
                dense
                to="chat"
                @click="setConversation(props.row.id)"
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
import Search from 'components/SearchInput.vue';
import { LLMTask } from 'src/modules/taskyon/types';
import Task from 'src/components/TaskWidget.vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { findLeafTasks } from 'src/modules/taskyon/taskManager';
import { matPlayArrow, matSync } from '@quasar/extras/material-icons';

const state = useTaskyonStore();
const searchResults = ref<(LLMTask & { distance: number | undefined })[]>([]);
const syncProgressString = ref('0/0');
const syncProgress = ref(0.0);
const taskCount = ref<number | string>('N/A');
const indexCount = ref<number | string>('N/A');

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

async function onSearchChange(searchTerm: string | Event, k: number) {
  if (searchTerm instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return;
  } else if (!searchTerm) {
    searchResults.value = [];
  } else {
    // Perform your search here
    console.log(`Searching for ${searchTerm}`);
    const taskManager = await state.getTaskManager();
    //searchResults.value = await vectorStore.query(searchTerm, k)
    if (taskManager) {
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
    }
    console.log('finished search!');
    console.log(searchResults.value);
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
  const taskManager = await state.getTaskManager();
  const leafTasks = await findLeafTasks(taskId, (taskID) =>
    taskManager.getTask(taskID),
  );
  state.llmSettings.selectedTaskId = leafTasks[0];
}
</script>
