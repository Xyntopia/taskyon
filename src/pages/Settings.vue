<template>
  <q-page>
    Settings
    <ObjectTreeView v-model="chatStateProperties"/>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import { storeToRefs } from 'pinia'

const state = useTaskyonStore();
const { Tasks, ...chatStateProperties } = storeToRefs(state).chatState.value;
</script>
