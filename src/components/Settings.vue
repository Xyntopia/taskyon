<!-- Sidebar -->
<template>
  <div>
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
    </div>
    <OpenRouterPKCE />
    <div v-if="!reduced">
      <q-separator spaced />
      <div class="q-pa-sm q-gutter-md">
        <div>Select Default AI Provider</div>
        <q-select
          v-model="state.chatState.selectedApi"
          emit-value
          dense
          label="select Api"
          :options="
            state.chatState.llmApis.map((api) => ({
              value: api.name,
              label: api.name,
            }))
          "
        />
        <q-input
          v-for="(key, keyname) of state.keys"
          :key="keyname"
          placeholder="Add API key here!"
          filled
          v-model="state.keys[keyname]"
          :label="`${keyname} API key`"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import OpenRouterPKCE from './OpenRouterPKCE.vue';

defineProps({
  reduced: {
    type: Boolean,
    required: false,
  },
});

const state = useTaskyonStore();
</script>
