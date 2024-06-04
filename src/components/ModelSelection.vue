<template>
  <div class="row items-start q-gutter-xs">
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
        color="secondary"
        label="Select OpenAI Assistant"
        :icon="matSmartToy"
        :options="modelOptions"
        emit-value
        map-options
        :model-value="openAIAssistantId"
        @update:model-value="(val) => emit('update:openAIAssistantId', val)"
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
    <div v-else class="col" style="min-width: 200px">
      <q-select
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
              {{ state.modelLookUp[botName]?.pricing?.prompt || '?' }}
            </div>
            <div>
              completion:
              {{ state.modelLookUp[botName]?.pricing?.completion || '?' }}
            </div>
          </div>
        </template>
      </q-select>
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
} from '@quasar/extras/material-icons';
import ApiSelect from './ApiSelect.vue';

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

const modelOptions = computed(() => {
  // openai has no pricing information attached, so we sort it in different ways...
  if (props.selectedApi === 'openai') {
    if (props.enableOpenAIAssistants) {
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
    newService: props.selectedApi,
  });
}

function onApiSelect(value: string) {
  const newBotName = state.llmSettings.llmApis[value]?.defaultModel;
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
