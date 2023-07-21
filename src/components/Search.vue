<template>
  <div class="column">
    <div class="col-auto">
      <q-toolbar class="q-px-none rounded-borders componentSearchBar">
        <q-input class="col" outlined :loading="searchState" type="search" autofocus :dense="false" clearable
          debounce="1000" :label="searchHint" :model-value="searchString" @update:model-value="onQChange">
          <template v-slot:append>
            <q-btn round flat @click="requestSearch" icon="search" />
          </template>
        </q-input>
        <q-btn v-if="showFilterButton" flat stretch icon="filter_alt" @click="toggleFilter">
          <q-tooltip>Toggle Filter Options</q-tooltip>
        </q-btn>
        <q-btn v-if="showGridButton" flat stretch dense :icon="usegrid ? 'view_list' : 'view_module'"
          @click="$emit('update:usegrid', !usegrid)" aria-label="Table">
          <q-tooltip>{{ usegrid ? 'Table Mode' : 'Grid Mode' }}</q-tooltip>
        </q-btn>
      </q-toolbar>
    </div>
    <div>
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
export default defineComponent({
  props: {
    searchState: {
      type: Boolean,
      default: false
    },
    searchHint: {
      type: String,
      default: 'Search...'
    },
    showFilterButton: {
      type: Boolean,
      default: false
    },
    showGridButton: {
      type: Boolean,
      default: false
    },
    usegrid: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { emit }) {
    const searchString = ref<string>('');

    function onQChange(value: string) {
      searchString.value = value
      emit('search', value);
    };

    const requestSearch = () => {
      emit('search', searchString.value);
    };

    const toggleFilter = () => {
      emit('toggleFilter');
    };

    return {
      onQChange,
      requestSearch,
      toggleFilter,
      searchString
    };
  }
})
</script>