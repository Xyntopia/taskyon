<template>
  <q-page padding>
    <q-card>
      <q-card-section>
        <ty-markdown
          :src="`
##  Infos and pricing for all available Models.

List of all of our currently available models in ${state.llmSettings.selectedApi} and their prices.
Most of these models are integrated through openrouter right now. We are working on
including additional providers to make even more use of the pricing competition in the current market.
`"
        />
        <api-select v-model="state.llmSettings.selectedApi" />
      </q-card-section>
      <q-table
        class="q-card"
        flat
        dense
        no-results-label="Could not find this model!"
        :rows="filteredTableData"
        :columns="columns"
        row-key="id"
        :pagination="{
          sortBy: 'prompt_price',
          descending: false,
          page: 0,
          rowsPerPage: 0,
          // rowsNumber: xx if getting data from a server
        }"
      >
        <template v-slot:top-left>
          <q-input
            dense
            clearable
            debounce="300"
            v-model="filter"
            placeholder="Filter Models"
          >
            <template v-slot:append>
              <q-icon :name="matFilterList" />
            </template>
          </q-input>
        </template>
        <template v-slot:top-right>
          <q-toggle
            label="Calculate price information as pages/0.01$ (assuming 500 token/page)"
            left-label
            v-model="pricingPerPage"
            color="secondary"
          />
        </template>
        <template v-slot:body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              {{ props.value }}
              <info-dialog>
                <ty-markdown :src="props.row.description" />
              </info-dialog>
            </div>
          </q-td>
        </template>
        <template v-slot:header-cell-prompt_price="props">
          <q-th :props="props">
            {{ pricingPerPage ? 'pages/0.01$' : 'μ$ / token' }}
          </q-th>
        </template>
        <template v-slot:body-cell-prompt_price="props">
          <q-td :props="props">
            <div v-if="!pricingPerPage">
              {{ openrouterPricing(props.value, 3) }}
            </div>
            <div v-else>
              {{ calculatePricePerPage(props.value) }}
            </div>
            <q-tooltip :delay="500">
              exact price: {{ props.value }}$/token <br />
              {{ calculatePricePerPage(props.value) }} pages/¢
            </q-tooltip>
          </q-td>
        </template>
        <template v-slot:header-cell-completion_price="props">
          <q-th :props="props">
            {{ pricingPerPage ? 'pages/0.01$' : 'μ$ / token' }}
          </q-th>
        </template>
        <template v-slot:body-cell-completion_price="props">
          <q-td :props="props">
            <div v-if="!pricingPerPage">
              {{ openrouterPricing(props.value, 3) }}
            </div>
            <div v-else>
              {{ calculatePricePerPage(props.value) }}
            </div>
            <q-tooltip :delay="500">
              exact price: {{ props.value }}$/token <br />
              {{ calculatePricePerPage(props.value) }} pages/¢
            </q-tooltip>
          </q-td>
        </template>
      </q-table>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState';
import { QTableProps } from 'quasar';
import { openrouterPricing } from 'src/modules/taskyon/utils';
import InfoDialog from 'src/components/InfoDialog.vue';
import { ref, computed } from 'vue';
import { matFilterList } from '@quasar/extras/material-icons';
import tyMarkdown from 'src/components/tyMarkdown.vue';
import ApiSelect from 'src/components/ApiSelect.vue';

const state = useTaskyonStore();
const filter = ref<string | null>('');
const pricingPerPage = ref(true);
//const { llmModels: tableData } = storeToRefs(state);

type rowType = (typeof state.llmModels)[0];

const filteredTableData = computed(() => {
  return state.llmModels.filter((model) =>
    model.name?.toLowerCase().includes((filter.value || '').toLowerCase())
  );
});

const columns: QTableProps['columns'] = [
  {
    name: 'name',
    label: 'Name',
    align: 'left',
    field: (row: rowType) => row.name,
    sortable: true,
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
    field: (row: rowType) => parseFloat(row.pricing?.prompt || '0'),
    sortable: true,
  },
  {
    name: 'completion_price',
    label: 'Completion Price',
    align: 'center',
    field: (row: rowType) => row.pricing?.completion,
    sortable: true,
  },
  {
    name: 'modality',
    label: 'vision?',
    align: 'center',
    field: (row: rowType) => row.architecture?.modality,
    format: (value) => value == 'multimodal',
    sortable: true,
  },
  {
    name: 'context_length',
    label: 'Context Length',
    align: 'center',
    field: (row: rowType) => row.context_length,
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
];

function calculatePricePerPage(value: number) {
  if (value < 0) {
    return 'dynamic';
  } else if (value == 0) {
    return 'free';
  } else {
    const ppt = 0.01 / (value * 500);
    return ppt.toFixed(1);
  }
}
</script>
