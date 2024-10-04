<template>
  <div class="row items-start q-gutter-xs">
    <!--LLM Model selection-->
    <div class="col row items-center" style="min-width: 200px">
      <q-select
        class="col"
        dense
        color="secondary"
        label="Select LLM Model for answering/solving the task."
        :icon="matSmartToy"
        :options="filteredOptions"
        emit-value
        :model-value="botName"
        hide-selected
        fill-input
        use-input
        input-debounce="0"
        v-bind="$attrs"
        @update:model-value="onModelSelect"
        @filter="
          (val: string, update: updateCallBack) =>
            filterModels(val, update, modelOptions)
        "
      >
        <template #prepend>
          <q-icon
            v-if="state.tyPublicKey"
            :name="mdiKeyLink"
            @click.stop.prevent
            ><q-tooltip
              >Only models allowed from taskyon key: "{{
                state.tyPublicKey.name
              }}"</q-tooltip
            ></q-icon
          >
        </template>
      </q-select>
      <ToggleButton
        v-model="showVisionModels"
        outline
        dense
        :on-icon="matVisibility"
        :off-icon="matVisibilityOff"
      >
        <q-tooltip :delay="200">
          Only Show Models which support vision.
        </q-tooltip>
      </ToggleButton>
      <div v-if="modelList" style="font-size: 0.5em">
        <q-btn :icon-right="matList" flat to="pricing">
          <q-tooltip>List of models</q-tooltip>
        </q-btn>
      </div>
    </div>
    <ApiSelect
      v-if="selectApi"
      :model-value="state.llmSettings.selectedApi"
      more-settings
      @update:model-value="onApiSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matSmartToy,
  matList,
  matVisibility,
  matVisibilityOff,
} from '@quasar/extras/material-icons';
import ApiSelect from './ApiSelect.vue';
import { mdiKeyLink } from '@quasar/extras/mdi-v6';
import { levenshteinDistance } from 'src/modules/string_utils';
import ToggleButton from '../ToggleButton.vue';

defineProps({
  botName: {
    type: String,
    required: true,
  },
  modelList: {
    type: Boolean,
    default: false,
  },
  selectApi: {
    type: Boolean,
    default: false,
  },
});

const selectedApi = defineModel<string | null>('selectedApi', {
  required: true,
});
const showVisionModels = ref(false);

const emit = defineEmits(['updateBotName']);

const state = useTaskyonStore();

const tyPublicKeyModels = computed(() => {
  if (selectedApi.value === 'taskyon') {
    // if we have a taskyon key defined only display the models allowed for that key...
    if (state.tyPublicKey?.model && state.tyPublicKey.model.length > 0) {
      const models = state.tyPublicKey.model;
      return models.map((m) => {
        console.log('only models from our key are available:', models);
        return { id: m, description: 'Model defined in ty public key.' };
      });
    }
  }
  return [];
});

const modelOptions = computed(() => {
  // openai has no pricing information attached, so we sort it in different ways...
  console.log('calculate model options!');
  if (selectedApi.value === 'openai') {
    const options = [...state.llmModels]
      .sort((m1, m2) => m1.id.localeCompare(m2.id))
      .map((m) => ({
        label: `${m.id}`,
        value: m.id,
      }));
    return options;
  } else {
    let llmModels: typeof state.llmModels = tyPublicKeyModels.value.length
      ? tyPublicKeyModels.value
      : state.llmModels;
    if (showVisionModels.value) {
      llmModels = llmModels.filter(
        (m) => m.architecture?.modality === 'text+image->text',
      );
    }
    const options = llmModels
      .map((m) => {
        const p = parseFloat(m.pricing?.prompt || '');
        const c = parseFloat(m.pricing?.completion || '');
        return { m, p: p + c };
      })
      .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
      .map(({ m }) => ({
        label:
          (m.architecture?.modality === 'text+image->text' ? '👁 ' : '') +
          `${m.id}: ${m.pricing?.prompt || 'N/A'}/${
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
    const newBotName = state.llmSettings.llmApis[modelValue]?.selectedModel;
    emit('updateBotName', {
      newName: newBotName,
      newService: modelValue,
    });
  }
}

const filteredOptions = ref<{ label: string; value: string }[]>([]);

type updateCallBack = (callback: () => void) => void;

function max(a: string, b: string) {
  return a.length > b.length ? a.length : b.length;
}

const filterModels = (
  val: string,
  update: updateCallBack,
  optionsRef: { label: string; value: string }[],
) => {
  update(() => {
    const keyword = val.toLowerCase().trim();
    const threshold = 0.5; // Set a threshold for what we show as an option. between 0% & 100% matching

    if (keyword) {
      const scoredOptions = optionsRef.map((option) => {
        /*const distance =
          levenshteinDistance(keyword, option.label) /
          max(keyword, option.label);*/
        const distance = levenshteinDistance(keyword, option.label);
        const matches = max(keyword, option.label) - distance;
        return { ...option, score: matches / keyword.length };
        //return { ...option, score: distance };
      });

      const sortedOptions = scoredOptions
        .filter((option) => option.score > threshold)
        .sort((a, b) => b.score - a.score)
        .map((x) => {
          return { ...x, label: x.label };
        });

      filteredOptions.value = sortedOptions;
    } else {
      filteredOptions.value = optionsRef;
    }
  });
};
</script>
