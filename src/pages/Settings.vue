<template>
  <q-page>
    Settings
    <ObjectTreeView/>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';

const state = useTaskyonStore();
const { Tasks, ...chatStateProperties } = state.chatState;
</script>
