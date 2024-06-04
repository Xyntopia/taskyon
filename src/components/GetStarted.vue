<template>
  <div class="welcome-message column items-center">
    <div
      class="text-h6 col-auto text-center"
      v-if="
        state.llmSettings.selectedApi &&
        state.keys[state.llmSettings.selectedApi]
      "
    >
      <p>Welcome! Just type a message below to start using Taskyon!</p>
    </div>
    <LLMProviders v-else />
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from './LLMProviders.vue';
const state = useTaskyonStore();
</script>
