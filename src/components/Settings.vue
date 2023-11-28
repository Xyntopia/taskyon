<!-- Sidebar -->
<template>
  <div>
    <q-toggle
      v-model="state.expertMode"
      label="Expert mode"
      left-label
      color="secondary"
    />
    <q-toggle
      v-model="state.showCosts"
      label="Show task costs"
      left-label
      color="secondary"
    />
    <q-separator spaced />
    <div class="q-pa-sm q-gutter-md">
      <q-btn-toggle
        v-model="state.chatState.baseURL"
        no-caps
        rounded
        unelevated
        bordered
        outline
        toggle-color="secondary"
        color="white"
        text-color="black"
        :options="[
          { label: 'OpenAI API', value: getBackendUrls('openai') },
          {
            label: 'Openrouter.ai API',
            value: getBackendUrls('openrouter'),
          },
        ]"
      />
      <q-input
        placeholder="Add API key here!"
        label-color="white"
        dense
        filled
        v-model="state.chatState.openRouterAIApiKey"
        label="Openrouter.ai API key"
      />
      <q-input
        placeholder="Add API key here!"
        label-color="white"
        dense
        filled
        v-model="state.chatState.openAIApiKey"
        label="OpenAI API Key"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { getBackendUrls } from 'src/modules/chat';
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();
</script>
