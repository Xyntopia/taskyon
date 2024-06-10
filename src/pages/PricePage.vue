<template>
  <q-page padding>
    <q-card>
      <q-card-section>
        <p class="text-h5">Taskyon AI Price for available Models.</p>
        <p>
          List of all currently available models in taskyon and their prices
        </p>
      </q-card-section>
      <q-table
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
            debounce="300"
            v-model="filter"
            placeholder="Filter Models"
          >
            <template v-slot:append>
              <q-icon :name="matFilterList" />
            </template>
          </q-input>
        </template>
        <template v-slot:body-cell-name="props">
          <q-td :props="props">
            <div class="row items-center">
              {{ props.value }}
              <info-dialog>
                {{ props.row.description }}
              </info-dialog>
            </div>
          </q-td>
        </template>

        <template v-slot:body-cell-prompt_price="props">
          <q-td :props="props">
            {{ openrouterPricing(props.value, 3) }}
            <q-tooltip :delay="500">exact price: {{ props.value }}</q-tooltip>
          </q-td>
        </template>
        <template v-slot:body-cell-completion_price="props">
          <q-td :props="props">
            {{ openrouterPricing(props.value, 3) }}
            <q-tooltip :delay="500">exact price: {{ props.value }}</q-tooltip>
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

const state = useTaskyonStore();
const filter = ref('');
//const { llmModels: tableData } = storeToRefs(state);

type rowType = (typeof state.llmModels)[0];

const filteredTableData = computed(() => {
  return state.llmModels.filter((model) =>
    model.name?.toLowerCase().includes(filter.value.toLowerCase())
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
    label: 'Prompt Price',
    align: 'center',
    field: (row: rowType) => row.pricing?.prompt,
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
</script>
