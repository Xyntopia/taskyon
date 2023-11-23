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
const { ...chatStateProperties } = toRefs(state.chatState);
</script>
