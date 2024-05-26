<!-- Sidebar -->
<template>
  <div class="q-gutter-md">
    <OpenRouterPKCE />
    <q-select
      v-model="state.chatState.selectedApi"
      emit-value
      dense
      label="connect to LLM Backend"
      :options="Object.keys(state.chatState.llmApis)"
    >
      <template v-slot:before>
        <q-icon name="electrical_services"></q-icon>
      </template>
    </q-select>
    <q-item-label header>API keys</q-item-label>
    <q-input
      v-for="keyname of filteredKeys"
      :key="keyname"
      :type="keyVisible[keyname] ? 'text' : 'password'"
      placeholder="Add API key here!"
      filled
      v-model="state.keys[keyname]"
      :label="`${keyname} API key`"
      ><template v-slot:append>
        <q-icon
          :name="keyVisible[keyname] ? 'visibility' : 'visibility_off'"
          class="cursor-pointer"
          @click="keyVisible[keyname] = !keyVisible[keyname]"
        />
      </template>
    </q-input>
    <q-expansion-item
      v-if="state.appConfiguration.expertMode"
      dense
      label="Edit Apis"
      icon="edit"
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
      <JsonInput v-model="state.chatState.llmApis" />
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import OpenRouterPKCE from './OpenRouterPKCE.vue';
import { computed, ref } from 'vue';
import JsonInput from './JsonInput.vue';
import TyMarkdown from './tyMarkdown.vue';

const keyVisible = ref<Record<string, boolean>>({});

const state = useTaskyonStore();
const filteredKeys = computed(() => {
  return Object.keys(state.keys).filter(
    (name) => !['taskyon', 'jwt'].includes(name)
  );
});
</script>
