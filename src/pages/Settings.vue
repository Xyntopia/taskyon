<template>
  <q-page>
    Settings
    <ObjectTreeView v-model="chatStateProperties" />
  </q-page>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';

const state = useTaskyonStore();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { Tasks, ...chatStateProperties } = toRefs(state.chatState);
</script>
