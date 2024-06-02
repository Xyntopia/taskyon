<!-- Sidebar -->
<template>
  <div class="q-gutter-md">
    <OpenRouterPKCE />
    <q-select
      v-model="state.llmSettings.selectedApi"
      emit-value
      outlined
      color="secondary"
      dense
      label="connect to LLM Backend"
      :options="Object.keys(state.llmSettings.llmApis)"
    >
      <template v-slot:before>
        <q-icon :name="matElectricalServices"></q-icon>
      </template>
    </q-select>
    <q-item-label header>API keys</q-item-label>

    <SecretInput
      v-for="keyname of filteredKeys"
      :key="keyname"
      placeholder="Add API key here!"
      filled
      v-model="state.keys[keyname]"
      :label="`${keyname} API key`"
    >
    </SecretInput>
    <q-expansion-item
      v-if="state.appConfiguration.expertMode"
      dense
      label="Edit Apis"
      :icon="matEdit"
    >
      <TyMarkdown
        src="Here, we can add new, custom APIs to taskyon that we can connect to
it is possible to add your own LLM Inference Server to connect
to your own AI this way. E.g. using these methods: 

- https://huggingface.co/blog/tgi-messages-api
- https://github.com/bentoml/OpenLLM

or with an llm proxy such as this one:  https://github.com/BerriAI/liteLLM-proxy
"
      />
      <JsonInput v-model="state.llmSettings.llmApis" />
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import OpenRouterPKCE from './OpenRouterPKCE.vue';
import { computed } from 'vue';
import JsonInput from './JsonInput.vue';
import TyMarkdown from './tyMarkdown.vue';
import SecretInput from './SecretInput.vue';
import { matEdit, matElectricalServices } from '@quasar/extras/material-icons';

const state = useTaskyonStore();
const filteredKeys = computed(() => {
  return Object.keys(state.keys); /*.filter(
    (name) => !['taskyon', 'jwt'].includes(name)
  );*/
});
</script>
