<template>
  <q-page padding>
    <q-card flat>
      <q-card-section>
        <ty-markdown
          class="pricing-page-intro"
          :src="`
##  Infos and pricing for all available Models.

List of all of our currently available models in ${state.llmSettings.selectedApi} and their prices.
The selected AI provider has to provide price information through an API in order to show them
on this list. *Dynamic* means that the backend changes the prices based on the input (E.g. by automatically
selecting different models).
`"
        />
        <api-select v-model="state.llmSettings.selectedApi" />
      </q-card-section>
      <q-toggle
        v-model="onlyAllowed"
        color="secondary"
        label="Only show available models (included in taskyon kee or free version)"
      />
      <q-table
        class="q-card"
        flat
        dense
        no-results-label="Could not find this model!"
        :rows="filteredTableData"
        :columns="columns"
        :table-row-class-fn="rowClassFn"
        row-key="id"
        :filter="state.modelFilter"
        :visible-columns="[
          'name',
          'created',
          'prompt_price',
          'completion_price',
          'request_price',
          'modality',
          'context_length',
        ]"
        :pagination="{
          sortBy: 'created',
          descending: true,
          page: 0,
          rowsPerPage: 0,
          // rowsNumber: xx if getting data from a server
        }"
      >
        <template #top-left>
          <q-input
            v-model="state.modelFilter"
            dense
            clearable
            debounce="300"
            placeholder="Filter Models"
          >
            <template #append>
              <q-icon :name="matFilterList" />
            </template>
          </q-input>
          <q-btn
            class="q-mx-sm"
            label="Download Model file as JSON"
            outline
            @click="downloadModels"
          ></q-btn>
        </template>
        <template #top-right>
          <q-select
            v-model="priceDisplay"
            dense
            :options="pricingOptions"
            label="Price Display"
            class="q-mr-md"
          />
        </template>
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              <div
                :class="props.row.id === tystate.currentModelId ? 'text-positive text-bold' : ''"
              >
                <q-icon v-if="props.row.id === tystate.currentModelId" :name="matCheck" />
                {{ props.value }}
              </div>
              <InfoDialog>
                <ty-markdown
                  :src="
                    props.row.description ??
                    `No information provided by Backend: **${state.llmSettings.selectedApi}**`
                  "
                />
                <object-tree-view v-model="props.row" read-only />
              </InfoDialog>
              <q-btn
                v-if="props.row.id !== tystate.currentModelId"
                flat
                label="select this model"
                @click="tystate.handleBotNameUpdate({ newName: props.row.id })"
              />
              <q-tooltip :delay="500"> id: {{ props.row.id }} </q-tooltip>
            </div>
          </q-td>
        </template>
        <template #header-cell-prompt_price="props">
          <q-th :props="props">
            <div>prompt</div>
            {{ priceDisplay }}
          </q-th>
        </template>
        <template #body-cell-prompt_price="props">
          <q-td :props="props">
            <div v-if="priceDisplay === '$/million tokens'">
              {{ calculatePricePerMillion(props.value) }}
            </div>
            <div v-else-if="priceDisplay === 'pages/0.01$'">
              {{ calculatePricePerPage(props.value) }}
            </div>
            <div v-else>
              {{ openrouterPricing(props.value, 3) }}
            </div>
            <q-tooltip :delay="500">
              exact price: {{ props.value }}$/token <br />
              {{ calculatePricePerMillion(props.value) }} $/million tokens
              {{ calculatePricePerPage(props.value) }} pages/¢
            </q-tooltip>
          </q-td>
        </template>
        <template #header-cell-completion_price="props">
          <q-th :props="props">
            <div>completion</div>
            {{ priceDisplay }}
          </q-th>
        </template>
        <template #body-cell-completion_price="props">
          <q-td :props="props">
            <div v-if="priceDisplay === '$/million tokens'">
              {{ calculatePricePerMillion(props.value) }}
            </div>
            <div v-else-if="priceDisplay === 'pages/0.01$'">
              {{ calculatePricePerPage(props.value) }}
            </div>
            <div v-else>
              {{ openrouterPricing(props.value, 3) }}
            </div>
            <q-tooltip :delay="500">
              exact price: {{ props.value }}$/token <br />
              {{ calculatePricePerMillion(props.value) }} $/million tokens
              {{ calculatePricePerPage(props.value) }} pages/¢
            </q-tooltip>
          </q-td>
        </template>
        <template #header-cell-request_price="props">
          <q-th :props="props">
            <div>request</div>
            {{ '$ / request' }}
          </q-th>
        </template>
        <template #body-cell-request_price="props">
          <q-td :props="props">
            <div>
              {{ humanReadablePrice(props.value, 0) }}
            </div>
            <q-tooltip :delay="500">
              exact price: {{ props.value }}$/request or {{ 1 / props.value }} requests per $
            </q-tooltip>
          </q-td>
        </template>
      </q-table>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState'
import { type QTableProps, exportFile } from 'quasar'
import { humanReadablePrice, openrouterPricing } from 'src/modules/utils'
import InfoDialog from 'components/InfoDialog.vue'
import { ref, computed } from 'vue'
import { matCheck, matFilterList } from '@quasar/extras/material-icons'
import tyMarkdown from 'components/tyMarkdown.vue'
import ApiSelect from 'components/taskyon/ApiSelect.vue'
import { useAppStateStore } from 'src/stores/appState'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'
import type { Model } from 'src/modules/taskyon/types'
import { useRoute, useRouter } from 'vue-router'

const pricingOptions = ['$/token', 'pages/0.01$', '$/million tokens'] as const

const tystate = useTaskyonStore()
const state = useAppStateStore()
const priceDisplay = ref<(typeof pricingOptions)[number]>(pricingOptions[2])

const route = useRoute()
const router = useRouter()

/** two‑way binding to ?onlyAllowed in the URL */
const onlyAllowed = computed<boolean>({
  get: () => route.query.onlyAllowed !== undefined, // treat mere presence as “true”
  /* or === 'true' if you prefer */
  set: (v) => {
    const q = { ...route.query }
    if (v) q.onlyAllowed = 'true'
    else delete q.onlyAllowed
    void router.replace({ query: q }) // shallow‑history update
  },
})

//const { llmModels: tableData } = storeToRefs(state);

type rowType = (typeof tystate.llmModels)[0]

const filteredTableData = computed(() => {
  const allModelsAllowed =
    tystate.allowedLLMModels === undefined || tystate.allowedLLMModels?.includes('*')
  return Object.values(tystate.llmModels)
    .filter((model) => {
      if (model.name || model.id) {
        return true
      }
      return false
    })
    .map((x) => ({
      ...x,
      inKey: allModelsAllowed ? undefined : tystate.allowedLLMModels?.includes(x.id) ? true : false,
    }))
    .filter((x) => !onlyAllowed.value || (x.inKey ?? x.inKey === undefined))
})

function rowClassFn(row: Model & { inKey: undefined | boolean }) {
  return row.inKey === undefined || row.inKey === true ? '' : 'not-in-key'
}

function floatSorter(a: string, b: string) {
  const numA = parseFloat(a)
  const numB = parseFloat(b)

  const validA = isNaN(numA) ? -1 : numA
  const validB = isNaN(numB) ? -1 : numB

  const comparison = validA - validB
  return comparison
}

const downloadModels = () => {
  console.log('download models')
  // Use Quasar's exportFile function for download
  exportFile('models.json', JSON.stringify(tystate.llmModels, null, 2), 'application/json')
}

const columns: QTableProps['columns'] = [
  {
    name: 'name',
    label: 'Name',
    align: 'left',
    // we are always filtering for one of those two values, so this is definitly available
    field: (row: rowType) => row.name ?? row.id,
    sortable: true,
  },
  {
    name: 'created',
    label: 'creation date',
    align: 'right',
    field: (row: rowType) => row.created,
    sortable: true,
    sort: floatSorter,
    format: (value: number) => {
      // Format the date string to a more readable format
      const date = new Date(value * 1000)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
      //return value
    },
  },
  /*{
    name: 'description',
    label: 'Description',
    align: 'left',
    field: (row: rowType) => row.description || '',
    sortable: false,
  },*/
  {
    name: 'prompt_price',
    label: 'pages/0.01$',
    align: 'center',
    field: (row: rowType) => row.pricing?.prompt,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'completion_price',
    label: 'Completion Price',
    align: 'center',
    field: (row: rowType) => row.pricing?.completion,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'request_price',
    label: 'Request Price',
    align: 'center',
    field: (row: rowType) => row.pricing?.request,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'modality',
    label: 'Modality',
    align: 'center',
    field: (row: rowType) => row.architecture?.modality || 'N/A',
    //format: (value) => value.architecture?.modality || 'N/A',
    sortable: true,
  },
  {
    name: 'context_length',
    label: 'Context Length',
    align: 'center',
    field: (row: rowType) => row.context_length || 'N/A',
    sortable: true,
  },
  {
    name: 'allowed',
    label: 'allowed',
    field: (row) => row.inKey,
    sortable: true,
  },
  /*{
    name: 'tokenizer',
    label: 'Tokenizer',
    align: 'center',
    field: (row: rowType) => row.architecture?.tokenizer,
    sortable: true,
  },
  {
    name: 'instruct_type',
    label: 'Instruct Type',
    align: 'center',
    field: (row: rowType) => row.architecture?.instruct_type,
    sortable: true,
  },*/
]

function calculatePricePerPage(value: string | undefined) {
  if (value) {
    const price = parseFloat(value)
    if (price < 0) {
      return 'dynamic'
    } else if (isNaN(price)) {
      return 'N/A'
    } else if (price === 0) {
      return 'free'
    } else {
      const ppt = 0.01 / (price * 500)
      return ppt.toFixed(1)
    }
  } else {
    return 'N/A'
  }
}

function calculatePricePerMillion(value: string | undefined) {
  if (value) {
    const price = parseFloat(value)
    if (price < 0) {
      return 'dynamic'
    } else if (isNaN(price)) {
      return 'N/A'
    } else if (price === 0) {
      return 'free'
    } else {
      return `$${(price * 1000000).toFixed(2)}`
    }
  } else {
    return 'N/A'
  }
}
</script>
