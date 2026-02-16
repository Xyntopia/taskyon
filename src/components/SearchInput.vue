<template>
  <div class="column">
    <div class="col-auto">
      <div class="row items-center q-px-none q-gutter-md rounded-borders componentSearchBar">
        <q-input
          class="col"
          :loading="isSearching"
          type="search"
          autofocus
          clearable
          debounce="1000"
          :label="searchHint"
          :model-value="searchString"
          v-bind="$attrs"
          @update:model-value="onQChange"
        >
          <template #append>
            <q-btn round flat :icon="matSearch" @click="requestSearch" />
          </template>
        </q-input>
        <q-select
          v-if="!hideNumberOfSearchResults"
          v-model="numberOfSearchResults"
          class="col-auto"
          dense
          debounce="300"
          type="number"
          style="max-width: 100px"
          :options="[5, 10, 25, 50, 100]"
          v-bind="$attrs"
          @update:model-value="requestSearch"
        >
          <q-tooltip>Number of search results.</q-tooltip>
        </q-select>
        <q-btn
          v-if="showFilterButton"
          class="col-auto"
          flat
          stretch
          :icon="matFilterAlt"
          @click="toggleFilter"
        >
          <q-tooltip>Toggle Filter Options</q-tooltip>
        </q-btn>
        <!--<q-btn v-if="showGridButton" flat stretch dense :icon="usegrid ? 'view_list' : 'view_module'"
          @click="$emit('update:usegrid', !usegrid)" aria-label="Table">
          <q-tooltip>{{ usegrid ? 'Table Mode' : 'Grid Mode' }}</q-tooltip>
        </q-btn>-->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matFilterAlt, matSearch } from '@quasar/extras/material-icons'

const numberOfSearchResults = defineModel<number | undefined>('numberOfSearchResults', {
  required: false,
  default: 50,
})

const showFilter = defineModel<boolean>('showFilter', {
  required: false,
  default: false,
})

const searchString = defineModel<string>('searchString', {
  required: false,
  default: '',
})

defineProps({
  isSearching: {
    type: Boolean,
    default: false,
  },
  searchHint: {
    type: String,
    default: 'Search...',
  },
  showFilterButton: {
    type: Boolean,
    default: false,
  },
  showGridButton: {
    type: Boolean,
    default: false,
  },
  usegrid: {
    type: Boolean,
    default: false,
  },
  hideNumberOfSearchResults: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['search'])

function onQChange(value: string | null | number) {
  searchString.value = (value as string) || ''
  emit('search', value, numberOfSearchResults.value)
}

const requestSearch = () => {
  emit('search', searchString.value, numberOfSearchResults.value)
}

const toggleFilter = () => {
  showFilter.value = !showFilter.value
}
</script>
