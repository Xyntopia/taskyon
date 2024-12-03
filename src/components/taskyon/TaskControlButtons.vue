<template>
  <div class="column q-gutter-xs">
    <div class="col-auto">
      <q-btn
        v-if="!state.lockBottomScroll"
        fab-mini
        class="taskyon-control-button"
        :icon="matKeyboardDoubleArrowDown"
        size="md"
        @click="$emit('scrollToThreadEnd')"
      >
        <q-tooltip> Scroll To Bottom </q-tooltip>
      </q-btn>
    </div>
    <div class="col-auto">
      <q-btn
        v-if="tystate.currentTask && !tystate.taskWorkerWaiting"
        fab-mini
        class="taskyon-control-button"
        :icon="matStop"
        size="md"
        :color="stoppingTasks ? 'secondary' : 'primary'"
        :loading="stoppingTasks"
        @click="stopTasks"
      >
        <q-tooltip> Stop processing current task. </q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matKeyboardDoubleArrowDown,
  matStop,
} from '@quasar/extras/material-icons';
import { sleep } from 'src/modules/utils';
import { useAppStateStore } from 'src/stores/appState';

const tystate = useTaskyonStore();
const state = useAppStateStore();

const stoppingTasks = ref(false);

defineEmits<{
  scrollToThreadEnd: [];
}>();

async function stopTasks() {
  console.log('stopping!');
  stoppingTasks.value = true;
  tystate.taskWorkerController.interrupt(tystate.currentTask?.id);

  await sleep(1000);
  // Poll every 500ms to check if the task is stopped
  while (!tystate.taskWorkerController.isWaiting()) {
    console.log('waiting for task to stop...');
    await sleep(100);
  }
  tystate.taskWorkerWaiting = true;
  stoppingTasks.value = false;
}
</script>
