<template>
  <FadeAwayScrollPage class="q-gutter-xs q-pa-xs">
    <q-btn flat :percentage="syncProgress" :icon="mdiRefresh" @click="onUpdateSearchIndex">
      update search index {{ syncProgressString }}
      <q-tooltip>Re-index all taskyon nodes! (Depending on size this mght take a while)</q-tooltip>
    </q-btn>
    <q-btn flat :icon="mdiDatabaseRemove" @click="onResetSearchIndex">
      clear search index
      <q-tooltip>This will delete the search index completly</q-tooltip>
    </q-btn>
    <q-btn
      v-if="state.appConfiguration.expertMode"
      flat
      :icon="mdiDatabase"
      label="Open SQL Search"
      to="/sql"
    >
      <q-tooltip>Expert users can use SQL queries on all taskyon data!</q-tooltip>
    </q-btn>
    <q-btn flat :icon="mdiFolderMultiple" label="File Manager" to="/fm">
      <q-tooltip>Open File Manager to see all stored files in taskyon.</q-tooltip>
    </q-btn>
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
          @search="(q, k) => onSearchChange({ q, k }, 'query')"
        />
        <div class="text-caption">
          # of indexed tasks: {{ indexCount }}
          <q-tooltip
            >Number of tasks in the index (Not all task types are indexed. E.g. chatCompletion is
            not indexed.)</q-tooltip
          >
        </div>
        <q-select
          :model-value="query.ct"
          class="q-pl-md"
          dense
          clearable
          label="filter for specific task type"
          :options="tasktypesOptions"
          style="min-width: 200px"
          @update:model-value="
            (contentType) =>
              onSearchChange(
                contentType != null ? { ct: String(contentType) } : { ct: undefined },
                'query',
              )
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
                @click="setConversation(rows.row.taskId)"
                ><q-tooltip>View entire conversation</q-tooltip></q-btn
              >
              <q-btn
                class="col-auto"
                outline
                :icon="mdiApproximatelyEqual"
                dense
                @click="onSearchChange({ t: rows.row.taskId }, 'similar')"
                ><q-tooltip>Search for similar tasks!</q-tooltip></q-btn
              >
              <div class="auto">
                {{ `${(1 / (rows.row.distance + 0.01)).toFixed(2)}` }}
                <q-tooltip>Search Similarity in %</q-tooltip>
              </div>
            </div>
            <div class="col q-pa-xs">
              <Task
                v-if="taskDataMap[rows.row.taskId]"
                :task="taskDataMap[rows.row.taskId]!"
                :message-debug="!!state.messageDebug[taskDataMap[rows.row.taskId]!.id]"
                show-meta
                @update:message-debug="
                  (value) => (state.messageDebug[taskDataMap[rows.row.taskId]!.id] = value)
                "
              />
              <div v-else>We could not find the task, is it possible that it was deleted?</div>
            </div>
          </div>
        </td>
      </template>
    </q-table>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import {
  mdiApproximatelyEqual,
  mdiDatabase,
  mdiDatabaseRemove,
  mdiFolderMultiple,
  mdiForum,
  mdiRefresh,
} from '@quasar/extras/mdi-v6'
import Search from '@taskyon/shared/components/SearchInput.vue'
import type { TaskNode } from '@taskyon/taskyon'
import { TaskContent } from '@taskyon/taskyon'
import Task from 'components/taskyon/TaskWidget.vue'
import { type QTableProps } from 'quasar'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import type { PartialDeep } from 'type-fest'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// TODO:  do some search caching ;) so that we can move faster back & forth between
//        pages in the browser...

const state = useAppStateStore()
const route = useRoute()

const defaultParams = {
  k: '10',
}

// If you want to map them to { label, value } for q-select:
const tasktypesOptions = TaskContent.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  const typeLiteral = opt.shape.type._zod.def.values[0]
  return typeLiteral
})

interface searchParams {
  ct?: string | undefined // content type,
  q?: string | undefined // searchTerm,
  k?: string // number of search results...
  t?: string | undefined // search for similar tasks...
}

const props = defineProps<{
  query: searchParams
}>()

const query = computed(() => ({
  ...defaultParams,
  ...props.query,
}))

// Inside your <script setup> section
const router = useRouter()

const tystate = useTaskyonStore()
const searchResults = ref<{ taskId: string; distance: number }[]>([])
const taskDataMap = ref<Record<string, TaskNode>>({})
const syncProgressString = ref('0/0')
const syncProgress = ref(0.0)
const taskCount = ref<number | string>('N/A')
const indexCount = ref<number | string>('N/A')
const isSearching = ref(false)

const updateCounts = () => {
  void tystate.taskyon.then((ty) => {
    void ty.countTasks().then((n) => (taskCount.value = n != undefined ? n : 'N/A'))
    void ty.countVecs().then((n) => (indexCount.value = n != undefined ? n : 'N/A'))
  })
}

updateCounts()

async function onUpdateSearchIndex() {
  const ty = await tystate.taskyon
  await ty.syncVectorIndexWithTasks((done, total) => {
    syncProgress.value = done / total
    syncProgressString.value = `${done}/${total}`
    indexCount.value = done
  })
  syncProgressString.value = '*done*'
  updateCounts()
}

async function onResetSearchIndex() {
  const ty = await tystate.taskyon
  await ty.resetTaskVectors()
  syncProgressString.value = '*done*'
  syncProgress.value = 0.0
  indexCount.value = 0
  updateCounts()
}

async function fetchAndDisplayTasks() {
  console.log('get task data from IDs')
  for (const task of searchResults.value) {
    if (!taskDataMap.value[task.taskId]) {
      const taskData = await tystate.taskyon.then((ty) => ty.getTask(task.taskId))
      if (taskData) taskDataMap.value[task.taskId] = taskData
    }
  }
}

async function searchTasks(params: searchParams & { k: string }) {
  console.log('searching tasks:', params)
  const ty = await tystate.taskyon
  //searchResults.value = await vectorStore.query(searchTerm, k)
  console.log('search for', params.q)
  isSearching.value = true
  const jsonfilter = params.ct
    ? ({
        content: {
          type: params.ct,
        },
      } as PartialDeep<TaskNode>)
    : undefined

  let result: {
    taskId: string
    distance: number
  }[] = []
  if (params.q) {
    result = await ty.filteredVectorSearch(params.q, parseInt(params.k), jsonfilter)
  } else if (params.t) {
    const task = await ty.getTask(params.t)
    if (task) {
      result = await ty.searchSimilarTasks(task, parseInt(params.k))
    }
  } else {
    result = await ty.filterSearch(parseInt(params.k), jsonfilter)
  }
  // Add score to each task
  searchResults.value = result
  taskCount.value = (await ty.countTasks()) || 'N/A'
  isSearching.value = false

  void fetchAndDisplayTasks()
}

async function onSearchChange(params: searchParams, mode: 'similar' | 'query') {
  if (params instanceof Event) {
    // for some reason, in chrome, a second event with the original input-event gets fired...
    return
  } else if (!params) {
    searchResults.value = []
  } else {
    // Update the URL with the search parameter
    const newQuery = { ...defaultParams, ...props.query, ...params }
    if (mode === 'similar') {
      delete newQuery.q
    }
    void router.push({ query: newQuery }) // Perform your search here
    console.log('Searching for: ', params)
    await searchTasks(newQuery)
    console.log('finished search!')
    console.log(searchResults.value)
  }
}

onMounted(() => {
  if (props.query) {
    console.log('doing initial search!')
    void searchTasks({ ...defaultParams, ...props.query })
  } else {
    searchResults.value = []
  }
})

watch(route, (newRoute) => {
  void searchTasks({ ...defaultParams, ...newRoute.query })
})

//const numberOfSearchResults = ref(5)
const initialPagination = {
  sortBy: 'distance',
  descending: false,
  //page: 2,
  rowsPerPage: 50,
  // rowsNumber: xx if getting data from a server
}

async function setConversation(taskId: string) {
  const ty = await tystate.taskyon
  const leafTasks = await ty.findSiblingLeafTasks(taskId)
  console.log('set conversation to', leafTasks[0])
  void router.push({ path: 'chat', query: { t: leafTasks[0] } })
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
]
</script>
