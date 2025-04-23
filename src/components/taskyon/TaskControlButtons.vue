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
        @click="stopTasks"
      >
        <q-tooltip> Stop processing current task. </q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState'
import { matKeyboardDoubleArrowDown, matStop } from '@quasar/extras/material-icons'
import { useAppStateStore } from 'src/stores/appState'

const tystate = useTaskyonStore()
const state = useAppStateStore()

defineEmits<{
  scrollToThreadEnd: []
}>()

function stopTasks() {
  tystate.taskWorkerController.interrupt(tystate.currentTask.value?.id)
  tystate.taskWorkerWaiting = true
}
</script>
