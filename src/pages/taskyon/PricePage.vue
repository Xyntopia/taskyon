<template>
  <q-page padding>
    <q-card flat>
      <!-- ───────── Intro ───────── -->
      <q-card-section class="taskyon-pricing">
        <q-expansion-item
          header-class="text-h6"
          label="Infos and pricing for all available Models."
        >
          <ty-markdown
            class="pricing-page-intro"
            :src="`
List of all of our currently available models in ${state.llmSettings.selectedApi} and their prices.
The selected AI provider has to provide price information through an API in order to show them
on this list.

For in in-depth comparison check out webpages like the following

- [artificialanalysis](https://artificialanalysis.ai/leaderboards/models?deprecation=current)
- [vellum.ai](https://www.vellum.ai/llm-leaderboard?utm_source=google&utm_medium=organic)
- [llm-stats.com](https://llm-stats.com/)
- [lmarena.ai](https://lmarena.ai/leaderboard)
- ... and many more [search](https://www.google.com/search?q=AI+model+rankings)
`"
          />
        </q-expansion-item>
        <ApiSelect v-model="state.llmSettings.selectedApi" />
      </q-card-section>

      <!-- ───────── Toggles ───────── -->
      <q-toggle
        v-model="onlyAllowed"
        color="secondary"
        label="Only show available models (included in Taskyon key or free version)"
      />
      <q-toggle
        v-model="sortAllowedFirst"
        color="primary"
        class="q-ml-md"
        label="Sort allowed models first"
      />

      <!-- ───────── Table ───────── -->
      <q-table
        class="q-card"
        flat
        dense
        no-results-label="Could not find this model!"
        :rows="filteredTableData"
        :columns="columns"
        :table-row-class-fn="rowClassFn"
        :sort-method="customSortMethod"
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
        }"
      >
        <!-- top‑left slot -->
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
          />
        </template>

        <!-- top‑right slot -->
        <template #top-right>
          <q-select
            v-model="priceDisplay"
            dense
            :options="pricingOptions"
            label="Price Display"
            class="q-mr-md"
          />
        </template>

        <!-- name column (body) -->
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              <q-icon
                v-if="!(props.row.inKey === undefined || props.row.inKey)"
                class="q-pr-xs"
                :name="matBlock"
              >
                <q-tooltip>
                  This model is not available for this kee (are you using the free key?)
                </q-tooltip>
              </q-icon>
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
                v-if="
                  props.row.id !== tystate.currentModelId &&
                  (props.row.inKey || props.row.inKey === undefined)
                "
                flat
                label="select this model"
                @click="tystate.updateModelAndApi({ newName: props.row.id })"
              />
              <q-tooltip :delay="500"> id: {{ props.row.id }} </q-tooltip>
            </div>
          </q-td>
        </template>

        <!-- prompt_price header + body -->
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

        <!-- completion_price header + body -->
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

        <!-- request_price header + body -->
        <template #header-cell-request_price="props">
          <q-th :props="props">
            <div>request</div>
            $ / request
          </q-th>
        </template>
        <template #body-cell-request_price="props">
          <q-td :props="props">
            <div>{{ humanReadablePrice(props.value, 0) }}</div>
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
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { type QTableProps, exportFile } from 'quasar'
import { matBlock, matCheck, matFilterList } from '@quasar/extras/material-icons'

import { useTaskyonStore } from 'src/stores/taskyonState'
import { useAppStateStore } from 'src/stores/appState'

import InfoDialog from 'components/InfoDialog.vue'
import tyMarkdown from 'components/tyMarkdown.vue'
import ApiSelect from 'components/taskyon/ApiSelect.vue'
import ObjectTreeView from 'src/components/ObjectTreeView.vue'

import { humanReadablePrice, openrouterPricing } from 'src/modules/utils'
import type { Model } from '@taskyon/taskyon'

/* ─────────── Local constants ─────────── */
const pricingOptions = ['$/token', 'pages/0.01$', '$/million tokens'] as const

/* ─────────── Stores & router ─────────── */
const tystate = useTaskyonStore()
const state = useAppStateStore()

const route = useRoute()
const router = useRouter()

/* ─────────── UI state ─────────── */
const priceDisplay = ref<(typeof pricingOptions)[number]>(pricingOptions[2])

/** two‑way bind to ?onlyAllowed query param */
const onlyAllowed = computed<boolean>({
  get: () => route.query.onlyAllowed !== undefined,
  set: (v) => {
    const q = { ...route.query }
    if (v) q.onlyAllowed = 'true'
    else delete q.onlyAllowed
    void router.replace({ query: q })
  },
})

/** two‑way bind to ?sortAllowedFirst query param */
const sortAllowedFirst = computed<boolean>({
  get: () => route.query.allowedFirst === 'true' || route.query.allowedFirst === undefined,
  set: (v) => {
    const q = { ...route.query }
    if (!v) q.allowedFirst = 'false'
    else delete q.allowedFirst
    void router.replace({ query: q })
  },
})

/* ─────────── Helpers ─────────── */
type Row = Model & { inKey?: boolean }

function rowClassFn(row: Row) {
  return row.inKey === undefined || row.inKey === true ? '' : 'not-in-key'
}

function floatSorter(a: string, b: string) {
  const numA = parseFloat(a)
  const numB = parseFloat(b)
  return (isNaN(numA) ? -1 : numA) - (isNaN(numB) ? -1 : numB)
}

function calculatePricePerPage(value: string | undefined) {
  if (!value) return 'N/A'
  const price = parseFloat(value)
  if (price < 0) return 'dynamic'
  if (isNaN(price)) return 'N/A'
  if (price === 0) return 'free'
  return (0.01 / (price * 500)).toFixed(1)
}

function calculatePricePerMillion(value: string | undefined) {
  if (!value) return 'N/A'
  const price = parseFloat(value)
  if (price < 0) return 'dynamic'
  if (isNaN(price)) return 'N/A'
  if (price === 0) return 'free'
  return `$${(price * 1_000_000).toFixed(2)}`
}

const downloadModels = () =>
  exportFile('models.json', JSON.stringify(tystate.llmModels, null, 2), 'application/json')

/* ─────────── Data preparation ─────────── */
const filteredTableData = computed(() => {
  const allAllowed =
    tystate.tyKeyAllowedModels === undefined || tystate.tyKeyAllowedModels.includes('*')

  return Object.values(tystate.llmModels)
    .filter((m) => m.name || m.id)
    .map((m) => ({
      ...m,
      inKey: allAllowed ? undefined : (tystate.tyKeyAllowedModels?.includes(m.id) ?? false),
    }))
    .filter((m) => !onlyAllowed.value || (m.inKey ?? true))
})

/* ─────────── Column defs ─────────── */
const columns: QTableProps['columns'] = [
  {
    name: 'name',
    label: 'Name',
    align: 'left',
    field: (row: Row) => row.name ?? row.id,
    sortable: true,
  },
  {
    name: 'created',
    label: 'creation date',
    align: 'right',
    field: (row: Row) => row.created ?? row.createdAt,
    sortable: true,
    sort: floatSorter,
    format: (v: number | string) => {
      try {
        const date = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
        return date.toISOString().slice(0, 10)
      } catch {
        return v
      }
    },
  },
  {
    name: 'prompt_price',
    label: 'pages/0.01$',
    align: 'center',
    field: (row: Row) => row.pricing?.prompt,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'completion_price',
    label: 'Completion Price',
    align: 'center',
    field: (row: Row) => row.pricing?.completion,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'request_price',
    label: 'Request Price',
    align: 'center',
    field: (row: Row) => row.pricing?.request,
    sortable: true,
    sort: floatSorter,
  },
  {
    name: 'modality',
    label: 'Modality',
    align: 'center',
    field: (row: Row) => row.architecture?.modality ?? row.pipeline_tag ?? 'N/A',
    sortable: true,
  },
  {
    name: 'context_length',
    label: 'Context Length',
    align: 'center',
    field: (row: Row) => row.context_length ?? 'N/A',
    sortable: true,
  },
  {
    name: 'allowed',
    label: 'allowed',
    field: (row: Row) => row.inKey,
    sortable: true,
  },
]

/* ─────────── Custom sort‑method ─────────── */
const defaultCompare = (a: unknown, b: unknown): number => {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(a).localeCompare(String(b))
}

const customSortMethod: QTableProps['sortMethod'] = (rows, sortBy, descending) => {
  const col = columns.find((c) => c.name === sortBy)
  if (!col) return rows

  /* helper: 0 = allowed (true|undefined) → top, 1 = not‑allowed → bottom */
  const allowedRank = (r: Row) => (r.inKey === false ? 1 : 0)

  /* helper: retrieve the cell value regardless of field‑type */
  const getValue = (row: Row) => {
    if (typeof col.field === 'function') {
      return col.field(row) // already typed by Quasar
    }
    // col.field is a string → cast to keyof Row so TS knows it exists
    const key = col.field as keyof Row
    return row[key]
  }
  const data = [...rows] as Row[]
  data.sort((rowA, rowB) => {
    /* 1️⃣ allowed‑first layer (if enabled) */
    if (sortAllowedFirst.value) {
      const diff = allowedRank(rowA) - allowedRank(rowB)
      if (diff !== 0) return diff
    }

    /* 2️⃣ column sort */
    const valA = getValue(rowA)
    const valB = getValue(rowB)

    let cmp: number
    if (typeof col.sort === 'function') {
      // column custom sort: (valA, valB, rowA, rowB)
      cmp = col.sort(valA as never, valB as never, rowA, rowB)
    } else {
      cmp = defaultCompare(valA, valB)
    }

    return descending ? -cmp : cmp
  })

  return data
}
</script>

<style scoped>
.not-in-key {
  opacity: 0.4;
}
</style>
