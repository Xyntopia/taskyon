<!-- Sidebar -->
<template>
  <div class="q-gutter-md">
    <div>You can acquire API keys from these services:</div>
    <div class="row">
      <q-btn
        class="col"
        label="Go to Taskyon.space to retrieve an API key."
        outline
        noCaps
        href="https://taskyon.space"
        target="_blank"
      />
      <InfoDialog
        info-text="You can also get an API key from https://openrouter.ai/keys and manually insert into the settings."
      />
    </div>
    <OpenRouterPKCE />
    <div v-if="state.appConfiguration.expertMode">
      Alternativly you can connect to other APIs that are configured. You can even
      setup your own server anc connect to it:
    </div>
    <q-card v-if="state.appConfiguration.expertMode" flat bordered>
      <q-card-section class="q-gutter-md">
        <div>
          <ApiSelect v-model="state.llmSettings.selectedApi" />
        </div>
        <div>Provide more API keys in order to activate other APIs:</div>
        <div>
          <SecretInput
            v-for="keyname of filteredKeys"
            :key="keyname"
            placeholder="Add API key here!"
            filled
            v-model="state.keys[keyname]"
            :label="`${keyname} API key`"
          >
          </SecretInput>
        </div>
      </q-card-section>
    </q-card>
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
import { matEdit, matKey } from '@quasar/extras/material-icons';
import { user } from 'src/modules/auth/supabase';
import ApiSelect from './ApiSelect.vue';
import ExpertEnable from 'src/pages/ExpertEnable.vue';

const state = useTaskyonStore();
const filteredKeys = computed(() => {
  return Object.keys(state.keys); /*.filter(
    (name) => !['taskyon', 'jwt'].includes(name)
  );*/
});
</script>
