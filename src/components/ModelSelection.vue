<template>
  <div class="row items-top q-gutter-xs">
    <div v-if="selectedApi === 'openai'" class="q-pt-xs">
      <q-btn-toggle
        label="mode"
        :model-value="enableOpenAIAssistants"
        @update:model-value="
          (val) => emit('update:enableOpenAIAssistants', val)
        "
        dense
        outline
        toggle-color="secondary"
        :color="$q.dark.isActive ? 'white' : 'primary'"
        :options="[
          { label: 'Chat', value: false },
          { label: 'Assistant', value: true },
        ]"
        ><q-tooltip>Select OpenAI Mode</q-tooltip>
      </q-btn-toggle>
    </div>
    <!--OpenAI Assistant selection-->
    <div
      v-if="enableOpenAIAssistants && selectedApi === 'openai'"
      class="col"
      style="min-width: 200px"
    >
      <q-select
        filled
        dense
        label="Select OpenAI Assistant"
        icon="smart_toy"
        :options="modelOptions"
        emit-value
        map-options
        :model-value="openAIAssistantId"
        @update:model-value="(val) => emit('update:openAIAssistantId', val)"
      >
        <template v-slot:after>
          <q-btn
            :icon="state.modelDetails ? 'expand_less' : 'expand_more'"
            flat
            @click="state.modelDetails = !state.modelDetails"
          >
            <q-tooltip>Check & configure the Assistants' details</q-tooltip>
          </q-btn>
        </template>
      </q-select>
      <div v-if="state.modelDetails">
        <div>
          <b>Assistant instructions:</b><br />
          {{ assistants[openAIAssistantId || '']?.instructions }}
        </div>
        <q-scroll-area style="height: 230px; max-width: 100%">
          <pre>
          {{ assistants[openAIAssistantId || ''] }}
          </pre>
        </q-scroll-area>
      </div>
    </div>
    <!--LLM Model selection-->
    <div v-else class="col" style="min-width: 200px">
      <q-select
        filled
        dense
        label="Select LLM Model for answering/solving the task."
        icon="smart_toy"
        :options="filteredOptions"
        emit-value
        :model-value="botName"
        @update:model-value="onModelSelect"
        hide-selected
        fill-input
        use-input
        input-debounce="100"
        @filter="(val, update) => filterModels(val, update, modelOptions)"
      >
        <template v-slot:after>
          <div
            v-if="state.appConfiguration.expertMode"
            style="font-size: 0.5em"
          >
            <q-tooltip>Prompt costs</q-tooltip>
            <div>
              prompt:
              {{
                modelLookUp['openrouter.ai'][botName]?.pricing?.prompt || '?'
              }}
            </div>
            <div>
              completion:
              {{
                modelLookUp['openrouter.ai'][botName]?.pricing?.completion ||
                '?'
              }}
            </div>
          </div>
        </template>
      </q-select>
    </div>
    <q-select
      style="min-width: 150px"
      :model-value="selectedApi"
      @update:model-value="onApiSelect"
      emit-value
      dense
      outlined
      label="select Api"
      :options="
        state.chatState.llmApis.map((api) => ({
          value: api.name,
          label: api.name,
        }))
      "
      ><q-tooltip>Choose LLM Api</q-tooltip>
    </q-select>
    <InfoDialog
      v-if="!enableOpenAIAssistants"
      class="col-auto"
      info-text="For a list of supported models go here:

- https://platform.openai.com/docs/models

or here:

- https://openrouter.ai/docs#models"
    >
    </InfoDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  availableModels,
  Model,
  getAssistants,
  getApiConfig,
  getApiByName,
} from 'src/modules/taskyon/chat';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
import { useTaskyonStore } from 'stores/taskyonState';
import openaiModels from 'assets/openai_models.json';
import InfoDialog from './InfoDialog.vue';

const props = defineProps({
  botName: {
    type: String,
    required: true,
  },
  selectedApi: {
    type: String,
    required: true,
  },
  enableOpenAIAssistants: {
    type: Boolean,
    required: true,
  },
  openAIAssistantId: {
    type: String,
    required: false,
  },
});

const emit = defineEmits([
  'update:openAIAssistantId',
  'update:enableOpenAIAssistants',
  'updateBotName',
]);

const state = useTaskyonStore();

const assistants = ref<Awaited<ReturnType<typeof getAssistants>>>({});

const resOpenRouter = ref<Model[]>(openrouterModules.data);
const resOpenAI = ref<Model[]>(openaiModels.data);
const api = getApiConfig(state.chatState);
if (api) {
  if (api.name != 'openrouter.ai')
    void availableModels(
      api.baseURL + api.routes.models,
      state.keys.openai
    ).then((res) => (resOpenAI.value = res));
}

watch(
  () => state.chatState.useOpenAIAssistants,
  (newValue) => {
    if (newValue) {
      void getAssistants(state.keys.openai).then((assitantDict) => {
        assistants.value = assitantDict;
      });
    }
  }
);

const modelOptions = computed(() => {
  if (props.selectedApi === 'openai') {
    if (props.enableOpenAIAssistants) {
      const options = Object.values(assistants.value).map((a) => ({
        value: a.id,
        label: a.name || '',
      }));
      return options;
    } else {
      const options = [...resOpenAI.value]
        .sort((m1, m2) => m1.id.localeCompare(m2.id))
        .map((m) => ({
          label: `${m.id}`,
          value: m.id,
        }));
      return options;
    }
  } else {
    const options = resOpenRouter.value
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
      }));
    return options;
  }
});

const modelLookUp = computed(() => ({
  openai: resOpenAI.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
  'openrouter.ai': resOpenRouter.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
}));

function onModelSelect(value: string) {
  emit('updateBotName', {
    newName: value,
    newService: props.selectedApi,
  });
}

function onApiSelect(value: string) {
  const newBotName = getApiByName(state.chatState, value)?.defaultModel;
  emit('updateBotName', {
    newName: newBotName,
    newService: value,
  });
}

const filteredOptions = ref<{ label: string; value: string }[]>([]);

const filterModels = (
  val: string,
  update: (callback: () => void) => void,
  optionsRef: { label: string; value: string }[]
) => {
  update(() => {
    const keyword = val.toLowerCase();
    filteredOptions.value = keyword
      ? optionsRef.filter((option) =>
          option.label.toLowerCase().includes(keyword)
        )
      : optionsRef;
  });
};
</script>
