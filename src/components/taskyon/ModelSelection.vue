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
      />
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
import { matSmartToy, matList } from '@quasar/extras/material-icons';
import ApiSelect from './ApiSelect.vue';

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

const emit = defineEmits(['updateBotName']);

const state = useTaskyonStore();

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
    const newBotName = state.llmSettings.llmApis[modelValue]?.selectedModel;
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
  optionsRef: { label: string; value: string }[],
) => {
  update(() => {
    const keyword = val.toLowerCase().trim();
    const threshold = 0.0; // Set a threshold for matching (70% of characters)

    if (keyword) {
      const scoredOptions = optionsRef.map((option) => {
        const score = calculateFuzzyScore(keyword, option.label);
        return { ...option, score };
      });

      const sortedFilteredOptions = scoredOptions
        .filter((option) => option.score >= threshold)
        .sort((a, b) => b.score - a.score);

      filteredOptions.value = sortedFilteredOptions;
    } else {
      filteredOptions.value = optionsRef;
    }
  });
};

/**
 * Function to calculate a score based on the similarity between the search term and the label.
 * @param searchTerm - The user's search input.
 * @param label - The option label to compare against.
 * @returns {number} - A score between 0 and 1 representing the similarity.
 */
function calculateFuzzyScore(searchTerm: string, label: string): number {
  let matchCount = 0;
  const lower_label = label.toLowerCase();

  // Count how many characters from the search term appear in the label
  for (let i = 0; i < searchTerm.length; i++) {
    if (lower_label.includes(searchTerm[i]!)) {
      matchCount++;
    }
  }

  // Calculate the match percentage
  const matchPercentage = matchCount / searchTerm.length;

  return matchPercentage;
}
</script>
