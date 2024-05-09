<!-- Sidebar -->
<template>
  <div :class="vertical ? 'column items-end' : ''">
    <q-toggle
      v-model="state.appConfiguration.expertMode"
      label="Expert mode"
      left-label
      color="secondary"
    />
    <q-toggle
      v-model="state.appConfiguration.showCosts"
      label="Show task costs"
      left-label
      color="secondary"
    />
    <q-toggle
      v-if="!reduced"
      v-model="state.appConfiguration.useEnterToSend"
      label="Enter to send message"
      left-label
      color="secondary"
    />
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';

defineProps({
  reduced: {
    type: Boolean,
    required: false,
  },
  vertical: {
    type: Boolean,
    required: false,
  },
});

const state = useTaskyonStore();
</script>
