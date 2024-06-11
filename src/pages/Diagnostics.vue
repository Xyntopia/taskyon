<template>
  <q-page class="q-pa-md q-gutter-md">
    <div v-for="(e, idx) of state.getErrors()" :key="idx">
      <p class="text-bold">{{ idx }}:</p>
      <pre>{{ e }}</pre>
    </div>
    <object-tree-view :model-value="stateView" />
  </q-page>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'src/components/ObjectTreeView.vue';
const state = useTaskyonStore();

const stateView = { ...state };
</script>
