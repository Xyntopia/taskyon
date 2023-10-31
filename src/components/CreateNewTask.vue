<template>
  <!--Create new task area-->
  <q-card-section>
    <q-input
      autogrow
      filled
      color="secondary"
      v-model="state.userInput"
      :hint="`Estimated number of tokens: ${estimatedTokens}`"
      label="Type your message..."
      @keyup="checkForShiftEnter"
    >
      <template v-slot:append>
        <q-icon
          v-if="state.userInput !== ''"
          name="close"
          @click="state.userInput = ''"
          class="cursor-pointer"
        />
        <q-btn flat dense stretch icon="send" @click="sendMessageWrapper" />
      </template>
    </q-input>
    <div class="row items-center">
      <q-btn
        class="q-ma-md"
        label="toggle all tools"
        @click="toggleSelectedTools"
      />
      <q-option-group
        class="q-ma-md"
        v-model="state.selectedTools"
        :options="
          Object.keys(tools).map((name) => ({
            label: name,
            value: name,
            description: tools[name].description,
          }))
        "
        color="secondary"
        type="checkbox"
        inline
        dense
      >
        <template v-slot:label="opt">
          <div>
            {{ opt.label }}
          </div>
          <q-tooltip anchor="bottom middle" style="max-width: 500px">{{
            opt.description
          }}</q-tooltip>
        </template></q-option-group
      >
    </div>
    <q-select
      v-if="state.chatState.baseURL == getBackendUrls('openai')"
      class="q-pt-xs"
      filled
      bottom-slots
      dense
      label="Select Openrouter.ai LLM"
      icon="smart_toy"
      :options="modelOptions.openrouter"
      emit-value
      v-model="state.chatState.openAIModel"
    >
      <template v-slot:hint>
        For a list of supported models go here:
        <a href="https://platform.openai.com/docs/models" target="_blank"
          >https://platform.openai.com/docs/models</a
        >
      </template>
    </q-select>
    <q-select
      v-else
      class="q-pt-xs"
      filled
      dense
      bottom-slots
      label="Select OpenAI LLM"
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
  </q-card-section>
</template>

<style lang="sass">
/* Define the CSS class for the orange "glow" shadow */
.not-assistant-message
  box-shadow: inset 0 0 5px $secondary
  border-radius: 5px
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  sendMessage,
  availableModels,
  Model,
  getBackendUrls,
  countStringTokens,
} from 'src/modules/chat';
import { tools } from 'src/modules/tools';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
import { useTaskyonStore } from 'stores/taskyonState';
import openaiModels from 'assets/openai_models.json';

const openrouterModels: Model[] = openrouterModules.data;
const openAiModels: Model[] = openaiModels.data;
const state = useTaskyonStore();

const resOpenRouter = ref<Model[]>([]);
const resOpenAI = ref<Model[]>([]);
async function fetchModels(): Promise<void> {
  try {
    resOpenRouter.value = await availableModels(
      getBackendUrls('openrouter'),
      state.chatState.openRouterAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    console.log('using default list');
    resOpenRouter.value = openrouterModels;
  }
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

const estimatedTokens = computed(() => {
  // Tokenize the message
  const tokens = countStringTokens(state.userInput);

  // Return the token count
  return tokens;
});

function toggleSelectedTools() {
  if (state.selectedTools?.length > 0) {
    state.selectedTools = [];
  } else {
    state.selectedTools = Object.keys(tools);
  }
}

function sendMessageWrapper() {
  void sendMessage(
    state.userInput.trim(),
    state.chatState,
    state.selectedTools
  );
  state.userInput = '';
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void sendMessageWrapper();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};
</script>
