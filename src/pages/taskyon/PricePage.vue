<template>
  <q-page padding>
    <q-card>
      <q-card-section>
        <ty-markdown
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
        <template #top-left>
          <q-input
            v-model="filter"
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
            label="Download Model file as JSON"
            outline
            @click="downloadModels"
          ></q-btn>
        </template>
        <template #top-right>
          <q-toggle
            v-model="pricingPerPage"
            label="Calculate price information as pages/0.01$ (assuming 500 token/page)"
            left-label
            color="secondary"
          />
        </template>
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              {{ props.value }}
              <info-dialog>
                <ty-markdown
                  :src="
                    props.row.description ??
                    `No information provided by Backend: **${state.llmSettings.selectedApi}**`
                  "
                />
              </info-dialog>
            </div>
          </q-td>
        </template>
        <template #header-cell-prompt_price="props">
          <q-th :props="props">
            <div>prompt</div>
            {{ pricingPerPage ? 'pages/0.01$' : 'μ$ / token' }}
          </q-th>
        </template>
        <template #body-cell-prompt_price="props">
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
        <template #header-cell-completion_price="props">
          <q-th :props="props">
            <div>completion</div>
            {{ pricingPerPage ? 'pages/0.01$' : 'μ$ / token' }}
          </q-th>
        </template>
        <template #body-cell-completion_price="props">
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
import { QTableProps, exportFile } from 'quasar';
import { openrouterPricing } from 'src/modules/utils';
import InfoDialog from 'components/InfoDialog.vue';
import { ref, computed } from 'vue';
import { matFilterList } from '@quasar/extras/material-icons';
import tyMarkdown from 'components/tyMarkdown.vue';
import ApiSelect from 'components/taskyon/ApiSelect.vue';

const state = useTaskyonStore();
const filter = ref<string | null>('');
const pricingPerPage = ref(true);
//const { llmModels: tableData } = storeToRefs(state);

type rowType = (typeof state.llmModels)[0];

const filteredTableData = computed(() => {
  return state.llmModels.filter((model) => {
    if (model.name || model.id) {
      return true;
    }
    return false;
  });
});

function floatSorter(a: string, b: string) {
  const numA = parseFloat(a);
  const numB = parseFloat(b);

  const validA = isNaN(numA) ? -1 : numA;
  const validB = isNaN(numB) ? -1 : numB;

  const comparison = validA - validB;
  console.log(comparison);
  return comparison;
}

const downloadModels = () => {
  console.log('download models');
  // Use Quasar's exportFile function for download
  exportFile(
    'models.json',
    JSON.stringify(state.llmModels, null, 2),
    'application/json',
  );
};

const columns: QTableProps['columns'] = [
  {
    name: 'name',
    label: 'Name',
    align: 'left',
    // we are always filtering for one of those two values, so this is definitly available
    field: (row: rowType) => row.name ?? row.id,
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

function calculatePricePerPage(value: string | undefined) {
  if (value) {
    const price = parseFloat(value);
    if (price < 0) {
      console.log('nan price');
      return 'dynamic';
    } else if (isNaN(price)) {
      return 'N/A';
    } else if (price === 0) {
      return 'free';
    } else {
      const ppt = 0.01 / (price * 500);
      return ppt.toFixed(1);
    }
  } else {
    return 'N/A';
  }
}
</script>
