<!-- Sidebar -->
<template>
  <div>
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
    <q-separator spaced />
    <div class="q-pa-sm q-gutter-md">
      <div>Select AI Provider</div>
      <q-btn-toggle
        v-model="state.chatState.selectedApi"
        no-caps
        rounded
        unelevated
        bordered
        outline
        toggle-color="secondary"
        color="white"
        text-color="black"
        :options="
          state.chatState.llmApis.map((api) => ({
            value: api.name,
            label: api.name,
          }))
        "
      />
      <q-input
        placeholder="Add API key here!"
        label-color="white"
        dense
        filled
        v-model="state.keys[state.chatState.selectedApi]"
        :label="`${state.chatState.selectedApi} API key`"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();
</script>
