<template>
  <q-toggle
    class="q-pa-sm"
    dense
    size="xs"
    v-model="state.appConfiguration.expertMode"
    label="Extended Settings"
    left-label
    color="secondary"
  />
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState';
const state = useTaskyonStore();
</script>
