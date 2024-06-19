<template>
  <q-page class="q-pa-md q-gutter-md">
    <div v-for="(e, idx) of state.getErrors()" :key="idx">
      <p class="text-bold">{{ idx }}:</p>
      <pre>{{ e }}</pre>
    </div>
    <q-expansion-item label="state">
      <object-tree-view :model-value="appConfiguration" />
    </q-expansion-item>
    <q-expansion-item label="router">{{ $router }}</q-expansion-item>
    <q-expansion-item label="route">{{ $route }}</q-expansion-item>
  </q-page>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'src/components/ObjectTreeView.vue';
import { storeToRefs } from 'pinia';
const state = useTaskyonStore();

const { appConfiguration } = storeToRefs(state);
//const stateView = {...state}
</script>
