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
        <div>
          you can find available models here:
          <q-btn
            flat
            color="accent"
            href="https://openrouter.ai/api/v1/models"
            target="_blank"
            >https://openrouter.ai/api/v1/models</q-btn
          >
          as soon as you have logged in to your openrouter account:
          <q-btn
            flat
            color="accent"
            href="https://accounts.openrouter.ai/sign-in"
            target="_blank"
            >https://accounts.openrouter.ai/sign-in</q-btn
          >
        </div>
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
          v-for="keyname of filteredKeys"
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
import { computed } from 'vue';

defineProps({
  reduced: {
    type: Boolean,
    required: false,
  },
});

const state = useTaskyonStore();
const filteredKeys = computed(() => {
  return Object.keys(state.keys).filter(
    (name) => !['taskyon', 'jwt'].includes(name)
  );
});
</script>
