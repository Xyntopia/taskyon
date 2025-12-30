<template>
  <div class="row items-start q-gutter-xs model-selection">
    <!--LLM Model selection-->
    <div class="col row items-center" style="min-width: 200px">
      <q-select
        ref="selectModelInput"
        class="col"
        dense
        color="secondary"
        options-dense
        label="Select LLM Model for answering/solving the task."
        :options="filteredOptions"
        emit-value
        :model-value="botName"
        hide-selected
        use-input
        fill-input
        input-debounce="0"
        v-bind="$attrs"
        :display-value="botName || ''"
        @update:model-value="onModelSelect"
        @filter="
          (val: string, update: updateCallBack, abort: () => void) =>
            filterModels(val, update, abort, modelOptions)
        "
        @filter-abort="abortFilterFn"
        @keydown.enter="selectFirstOption"
      >
        <template #prepend>
          <q-icon v-if="selectedApi === 'taskyon' && tystate.taskyonKey" :name="mdiKeyLink">
            <q-tooltip
              >Only models allowed from taskyon key: {{ tystate.taskyonKey.name }}</q-tooltip
            >
          </q-icon>
        </template>
      </q-select>
      <ToggleButton
        v-model="showVisionModels"
        outline
        dense
        :on-icon="matVisibility"
        :off-icon="matVisibility"
      >
        <q-tooltip :delay="200"> Only Show Models which support vision. </q-tooltip>
      </ToggleButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { matVisibility } from '@quasar/extras/material-icons'
import { mdiKeyLink } from '@quasar/extras/mdi-v6'
import { levenshteinDistance } from 'src/modules/string_utils'
import { useTaskyonStore } from 'stores/taskyonState'
import { computed, ref } from 'vue'
import ToggleButton from '../ToggleButton.vue'

defineProps<{
  botName: string | null
  modelList?: boolean
  selectApi?: boolean
}>()

const selectedApi = defineModel<string | null>('selectedApi', {
  required: true,
})
const showVisionModels = ref(false)

const emit = defineEmits<{
  updateBotName: [
    {
      newName: string
      newService?: string | null
    },
  ] // named tuple syntax
}>()

const tystate = useTaskyonStore()

const selectModelInput = ref()

const modelOptions = computed(() => {
  // openai has no pricing information attached, so we sort it in different ways...
  console.log('calculate model options!')
  if (selectedApi.value === 'openai') {
    const options = Object.values(tystate.llmModels)
      .sort((m1, m2) => m1.id.localeCompare(m2.id))
      .map((m) => ({
        label: `${m.id}`,
        value: m.id,
      }))
    return options
  } else {
    let llmModels = Object.values(tystate.llmModels)
    if (tystate.tyKeyAllowedModels) {
      llmModels = llmModels.filter((m) =>
        m.id ? tystate.tyKeyAllowedModels?.includes(m.id) : false,
      )
    }
    if (showVisionModels.value) {
      llmModels = llmModels.filter((m) => m.architecture?.modality === 'text+image->text')
    }
    const options = llmModels
      .map((m) => {
        const p = parseFloat(m.pricing?.prompt || '')
        const c = parseFloat(m.pricing?.completion || '')
        return { m, p: p + c }
      })
      .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
      .map(({ m }) => ({
        label: (m.architecture?.modality === 'text+image->text' ? '👁 ' : '') + m.id,
        value: m.id,
      }))
    return options
  }
})

function onModelSelect(value: string) {
  console.log('selecting a new model...', value)
  emit('updateBotName', {
    newName: value,
    newService: selectedApi.value,
  })
}

const filteredOptions = ref<{ label: string; value: string }[]>([])

type updateCallBack = (callback: () => void) => void

function max(a: string, b: string) {
  return a.length > b.length ? a.length : b.length
}

const filterModels = (
  val: string,
  update: updateCallBack,
  abort: () => void,
  optionsRef: { label: string; value: string }[],
) => {
  update(() => {
    const keyword = val.toLowerCase().trim()
    // 1.1 is the maximum achievable score for us..
    const threshold = 0.7 * 1.1 // Set a threshold for what we show as an option. between 0% & 100% matching

    if (keyword) {
      const scoredOptions = optionsRef.map((option) => {
        const optionValue = option.value
        const distance = levenshteinDistance(keyword, optionValue)
        // number of characters of our search query which match
        const matches = max(keyword, optionValue) - distance
        return {
          ...option,
          // we calculate the score as a mix of matches of the keyword and the entire string
          score:
            matches / keyword.length +
            ((0.1 * keyword.length) / optionValue.length) * (matches / optionValue.length),
        }
      })

      const sortedOptions = scoredOptions
        .filter((option) => option.score > threshold)
        .sort((a, b) => b.score - a.score)
        .map((x) => {
          return { ...x, label: x.label }
        })
        .slice(0, 20)

      filteredOptions.value = sortedOptions
    } else {
      filteredOptions.value = optionsRef
    }
  })
}

const abortFilterFn = () => {
  console.log('delayed filter aborted')
}

function selectFirstOption() {
  const firstOption = filteredOptions.value[0]?.value ?? ''
  onModelSelect(firstOption)
  selectModelInput.value.updateInputValue(firstOption)
}
</script>
