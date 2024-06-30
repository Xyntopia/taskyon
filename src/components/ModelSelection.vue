<template>
  <div class="row items-start q-gutter-xs">
    <div v-if="false && selectedApi === 'openai'" class="q-pt-xs">
      <q-btn-toggle
        label="mode"
        v-model="useOpenAIAssistants"
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
      v-if="useOpenAIAssistants && selectedApi === 'openai'"
      class="col"
      style="min-width: 200px"
    >
      <q-select
        filled
        dense
        color="secondary"
        label="Select OpenAI Assistant"
        :icon="matSmartToy"
        :options="modelOptions"
        emit-value
        map-options
        v-model="openAIAssistantId"
      >
        <template v-slot:after>
          <q-btn
            :icon="state.modelDetails ? matExpandLess : matExpandMore"
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
          {{ state.assistants[openAIAssistantId || '']?.instructions }}
        </div>
        <q-scroll-area style="height: 230px; max-width: 100%">
          <pre>
          {{ state.assistants[openAIAssistantId || ''] }}
          </pre>
        </q-scroll-area>
      </div>
    </div>
    <!--LLM Model selection-->
    <div v-else class="col row items-center" style="min-width: 200px">
      <q-select
        class="col"
        dense
        color="secondary"
        label="Select LLM Model for answering/solving the task."
        :icon="matSmartToy"
        :options="filteredOptions"
        emit-value
        :model-value="botName"
        @update:model-value="onModelSelect"
        hide-selected
        fill-input
        use-input
        input-debounce="0"
        @filter="(val: string, update: updateCallBack) => filterModels(val, update, modelOptions)"
      >
      </q-select>
      <div v-if="state.appConfiguration.expertMode" style="font-size: 0.5em">
        <q-btn :icon-right="matList" flat to="pricing">
          >
          <q-tooltip>List of models</q-tooltip>
        </q-btn>
      </div>
    </div>
    <ApiSelect
      v-if="state.appConfiguration.expertMode"
      :model-value="state.llmSettings.selectedApi"
      @update:model-value="onApiSelect"
      more-settings
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matSmartToy,
  matExpandLess,
  matExpandMore,
  matList,
} from '@quasar/extras/material-icons';
import ApiSelect from './ApiSelect.vue';

defineProps({
  botName: {
    type: String,
    required: true,
  },
});

const selectedApi = defineModel<string | null>('selectedApi', {
  required: true,
});

const useOpenAIAssistants = defineModel<boolean>('useOpenAIAssistants', {
  required: true,
});

const openAIAssistantId = defineModel<string>('openAIAssistantId', {
  required: false,
});

const emit = defineEmits(['updateBotName']);

const state = useTaskyonStore();

const modelOptions = computed(() => {
  // openai has no pricing information attached, so we sort it in different ways...
  console.log('calculate model options!');
  if (selectedApi.value === 'openai') {
    if (useOpenAIAssistants.value) {
      const options = Object.values(state.assistants).map((a) => ({
        value: a.id,
        label: a.name || '',
      }));
      return options;
    } else {
      const options = [...state.llmModels]
        .sort((m1, m2) => m1.id.localeCompare(m2.id))
        .map((m) => ({
          label: `${m.id}`,
          value: m.id,
        }));
      return options;
    }
  } else {
    const options = state.llmModels
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

function onModelSelect(value: string) {
  emit('updateBotName', {
    newName: value,
    newService: selectedApi.value,
  });
}

function onApiSelect(modelValue: string | null) {
  if (modelValue) {
    const newBotName = state.llmSettings.llmApis[modelValue]?.defaultModel;
    emit('updateBotName', {
      newName: newBotName,
      newService: modelValue,
    });
  }
}

const filteredOptions = ref<{ label: string; value: string }[]>([]);

type updateCallBack = (callback: () => void) => void;

const filterModels = (
  val: string,
  update: updateCallBack,
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
