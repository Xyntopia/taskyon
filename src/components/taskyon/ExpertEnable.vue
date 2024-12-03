<template>
  <q-toggle
    v-model="state.appConfiguration.expertMode"
    class="q-pa-sm"
    dense
    size="xs"
    label="Expert Settings"
    left-label
    color="secondary"
    v-bind="$attrs"
  />
</template>

<script setup lang="ts">
import { useAppStateStore } from 'src/stores/appState';
const state = useAppStateStore();
</script>
