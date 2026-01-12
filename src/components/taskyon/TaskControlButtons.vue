<!--TaskControlButtons.vue-->
<template>
  <div class="column q-gutter-xs task-control-buttons">
    <!-- scroll to top -->
    <div v-if="showTopScroll" class="col-auto">
      <q-btn
        fab-mini
        class="taskyon-control-button"
        :icon="matKeyboardDoubleArrowUp"
        size="md"
        @click="$emit('scrollToTop')"
      >
        <q-tooltip> Scroll To Top </q-tooltip>
      </q-btn>
    </div>

    <!-- scroll to previous message -->
    <div v-if="showTopScroll" class="col-auto">
      <q-btn
        fab-mini
        class="taskyon-control-button"
        :icon="matKeyboardArrowUp"
        size="md"
        @click="$emit('scrollToPrevMessage')"
      >
        <q-tooltip> Scroll To Previous Message </q-tooltip>
      </q-btn>
    </div>

    <!-- scroll to next message -->
    <div v-if="showBottomScroll" class="col-auto">
      <q-btn
        fab-mini
        class="taskyon-control-button"
        :icon="matKeyboardArrowDown"
        size="md"
        @click="$emit('scrollToNextMessage')"
      >
        <q-tooltip> Scroll To Next Message </q-tooltip>
      </q-btn>
    </div>

    <!-- scroll to bottom -->
    <div v-if="showBottomScroll" class="col-auto">
      <q-btn
        fab-mini
        class="taskyon-control-button"
        :icon="matKeyboardDoubleArrowDown"
        size="md"
        @click="$emit('scrollToThreadEnd')"
      >
        <q-tooltip> Scroll To Bottom </q-tooltip>
      </q-btn>
    </div>

    <!-- stop button (existing) -->
    <div class="col-auto">
      <q-btn
        v-if="tystate.currentTask && !tystate.taskWorkerWaiting"
        fab-mini
        class="taskyon-control-button"
        :icon="matStop"
        size="md"
        @click="tystate.stopWorker('User stopped all tasks')"
      >
        <q-tooltip> Stop processing current task. </q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState'
import {
  matKeyboardDoubleArrowDown,
  matKeyboardArrowDown,
  matKeyboardArrowUp,
  matKeyboardDoubleArrowUp,
  matStop,
} from '@quasar/extras/material-icons'

const tystate = useTaskyonStore()

defineProps<{
  showBottomScroll: boolean
  showTopScroll: boolean
}>()

defineEmits<{
  scrollToThreadEnd: []
  scrollToNextMessage: []
  scrollToPrevMessage: []
  scrollToTop: []
}>()
</script>
