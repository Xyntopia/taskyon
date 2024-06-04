<template>
  <div class="welcome-message column items-center">
    <div
      class="text-h6 col-auto text-center"
      v-if="state.keys[state.llmSettings.selectedApi]"
    >
      <q-icon
        class="q-pa-xl"
        size="10rem"
        name="svguse:taskyon_mono_opt.svg#taskyon"
      ></q-icon>
      <p>Welcome! Just type a message below to start using Taskyon!</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import { matKey, matSettings } from '@quasar/extras/material-icons';
const state = useTaskyonStore();
</script>
