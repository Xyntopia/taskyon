<template>
  <q-btn flat label="Reset History" @click="onResetTaskyon">
    <q-tooltip :delay="1000">Reset chat history & settings. (Only appears in local development mode)</q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';

const tystate = useTaskyonStore();

async function onResetTaskyon() {
  console.log('reset taskyon!');
  const tm = await tystate.getTaskManager();
  await tm.deleteAllTasks();
  tystate.$reset();
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload(); // reload browser window to reinitialize the db...
  //location.reload(); // reload browser window to reinitialize the db...
}
</script>
