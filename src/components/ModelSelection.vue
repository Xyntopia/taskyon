<template>
  <div
    v-if="state.chatState.baseURL == getBackendUrls('openai')"
    class="row items-top"
  >
    <div class="q-pt-xs">
      <q-btn-toggle
        v-model="state.chatState.useOpenAIAssistants"
        unelevated
        glossy
        dense
        toggle-color="secondary"
        color="primary"
        :options="[
          { label: 'Chat', value: false },
          { label: 'Assistant', value: true },
        ]"
        ><q-tooltip>Select OpenAI Mode</q-tooltip>
      </q-btn-toggle>
    </div>
    <!--OpenAI Assistant selection-->
    <div
      v-if="state.chatState.useOpenAIAssistants"
      class="col"
      style="min-width: 200px"
    >
      <q-select
        filled
        dense
        label="Select OpenAI Assistant"
        icon="smart_toy"
        :options="assistantOptions"
        emit-value
        map-options
        v-model="state.chatState.openAIAssistant"
      >
        <template v-slot:after>
          <q-btn
            icon="settings_applications"
            @click="state.modelDetails = !state.modelDetails"
          >
            <q-tooltip>Check & configure the Assistants' details</q-tooltip>
          </q-btn>
        </template>
      </q-select>
      <div v-if="state.modelDetails">
        <div>
          <b>Assistant instructions:</b><br />
          {{ assistants[state.chatState.openAIAssistant]?.instructions }}
        </div>
        <q-scroll-area style="height: 230px; max-width: 100%">
          <pre>
          {{ assistants[state.chatState.openAIAssistant] }}
          </pre>
        </q-scroll-area>
      </div>
    </div>
    <!--OpenAI Model selection-->
    <div v-else class="col" style="min-width: 200px">
      <q-select
        filled
        dense
        label="Select LLM Model for answering/solving the task."
        icon="smart_toy"
        :options="modelOptions.openrouter"
        emit-value
        v-model="state.chatState.openAIModel"
      >
      </q-select>
    </div>
    <div class="col-auto text-caption">
      For a list of supported models go here:
      <a href="https://platform.openai.com/docs/models" target="_blank"
        >https://platform.openai.com/docs/models</a
      >
    </div>
  </div>
  <!--openrouter.ai models-->
  <q-select
    v-else
    class="q-pt-xs"
    filled
    dense
    bottom-slots
    label="Select LLM Model for answering/solving the task."
    icon="smart_toy"
    :options="modelOptions.openai"
    emit-value
    v-model="state.chatState.openrouterAIModel"
  >
    <template v-slot:hint>
      For a list of supported models go here:
      <a href="https://openrouter.ai/docs#models" target="_blank"
        >https://openrouter.ai/docs#models</a
      >
    </template>
    <template v-slot:after>
      <div style="font-size: 0.5em">
        <div>
          prompt:
          {{
            modelLookUp.openrouter[state.chatState.openrouterAIModel]?.pricing
              ?.prompt
          }}
        </div>
        <div>
          completion:
          {{
            modelLookUp.openrouter[state.chatState.openrouterAIModel]?.pricing
              ?.completion
          }}
        </div>
      </div>
    </template>
  </q-select>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  availableModels,
  Model,
  getBackendUrls,
  getAssistants,
} from 'src/modules/chat';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
import { useTaskyonStore } from 'stores/taskyonState';
import openaiModels from 'assets/openai_models.json';

const openrouterModels: Model[] = openrouterModules.data;
const openAiModels: Model[] = openaiModels.data;
const state = useTaskyonStore();

const assistants = ref<Awaited<ReturnType<typeof getAssistants>>>({});
const assistantOptions = computed(() =>
  Object.values(assistants.value).map((a) => ({ value: a.id, label: a.name }))
);

void getAssistants(state.chatState).then((assitantDict) => {
  assistants.value = assitantDict;
});

const resOpenRouter = ref<Model[]>([]);
const resOpenAI = ref<Model[]>([]);
async function fetchModels(): Promise<void> {
  /*try {
    resOpenRouter.value = await availableModels(
      getBackendUrls('openrouter'),
      state.chatState.openRouterAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    console.log('using default list');
    resOpenRouter.value = openrouterModels;
  }*/
  resOpenRouter.value = openrouterModels;
  try {
    resOpenAI.value = await availableModels(
      getBackendUrls('openai'),
      state.chatState.openAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    resOpenAI.value = openAiModels;
  }
}

const modelOptions = computed(() => ({
  openai: resOpenRouter.value
    .map((m) => {
      const p = parseFloat(m.pricing?.prompt || '');
      const c = parseFloat(m.pricing?.completion || '');
      return { m, p: p + c };
    })
    .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
    .map(({ m }) => ({
      label: `${m.id}: ${m.pricing?.prompt || 'N/A'}/${
        m.pricing?.completion || 'N/A'
      }`,
      value: m.id,
    })),
  openrouter: [...resOpenAI.value]
    .sort((m1, m2) => m1.id.localeCompare(m2.id))
    .map((m) => ({
      label: `${m.id}`,
      value: m.id,
    })),
}));

const modelLookUp = computed(() => ({
  openai: resOpenAI.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
  openrouter: resOpenRouter.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
}));

void fetchModels();
</script>
