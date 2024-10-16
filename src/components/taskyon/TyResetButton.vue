<template>
  <q-btn flat label="Reset History" @click="onResetTaskyon">
    <q-tooltip :delay="1000">Reset chat history & settings.</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();

async function onResetTaskyon() {
  console.log('reset taskyon!');
  const tm = await state.getTaskManager();
  await tm.deleteAllTasks();
  state.$reset();
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload(); // reload browser window to reinitialize the db...
  //location.reload(); // reload browser window to reinitialize the db...
}
</script>
