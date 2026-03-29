<template>
  <div class="object-path-charts__row row q-col-gutter-sm items-center">
    <div class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="xPath"
        :options="pathOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        label="X path"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="yPath"
        :options="pathOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        clearable
        label="Y path"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="zPath"
        :options="pathOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        clearable
        label="Z path (optional)"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div class="object-path-charts__col col-12" :class="showRemove ? 'col-md-2' : 'col-md-3'">
      <q-input v-model="chartTitle" outlined dense label="Title (optional)" />
    </div>
    <div v-if="showRemove" class="object-path-charts__col col-12 col-md-1">
      <q-btn flat dense color="negative" label="Remove" @click="emit('remove')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Option = { label: string; value: string }

export type ObjectPathChartDefinition = {
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  title?: string | undefined
}

const props = withDefaults(
  defineProps<{
    pathOptions: Option[]
    showRemove?: boolean
  }>(),
  {
    showRemove: false,
  },
)

const configModel = defineModel<ObjectPathChartDefinition>('config', {
  default: () => ({}),
})

const xPath = computed({
  get: () => configModel.value.x ?? '',
  set: (value: string) => {
    configModel.value = { ...configModel.value, x: value || undefined }
  },
})

const yPath = computed({
  get: () => configModel.value.y ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, y: value || undefined }
  },
})

const zPath = computed({
  get: () => configModel.value.z ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, z: value || undefined }
  },
})

const chartTitle = computed({
  get: () => configModel.value.title ?? '',
  set: (value: string | number | null) => {
    const text = String(value ?? '').trim()
    configModel.value = { ...configModel.value, title: text || undefined }
  },
})

const emit = defineEmits<{
  (e: 'filter', value: string, update: (fn: () => void) => void): void
  (e: 'remove'): void
}>()

function handleFilter(value: string, update: (fn: () => void) => void) {
  emit('filter', value, update)
}

void props
</script>
