<template>
  <q-input
    v-model="jsonString"
    type="textarea"
    filled
    :readonly="readonly"
    v-bind="$attrs"
    :rules="[jsonRule]"
    :debounce="autoSave ? debounce : 0"
    @blur="onBlur"
  >
    <template v-if="!readonly && !autoSave" #append>
      <q-btn flat dense :icon="matSave" @click="onSave" />
    </template>
  </q-input>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { debounce as lodashDebounce } from 'lodash'
import { useQuasar } from 'quasar'
import { matSave } from '@quasar/extras/material-icons'

const props = defineProps({
  modelValue: { type: Object, required: true },
  readonly: { type: Boolean, default: false },
  autoSave: { type: Boolean, default: false }, // NEW
  debounce: { type: Number, default: 500 }, // NEW, ms
})

const emit = defineEmits(['update:modelValue'])
const q = useQuasar()

// keep textarea in sync
const jsonString = ref(JSON.stringify(props.modelValue, null, 2))
watch(
  () => props.modelValue,
  (v) => {
    jsonString.value = JSON.stringify(v, null, 2)
  },
  { deep: true },
)

// rule for QInput
const jsonRule = (val: string) => {
  try {
    JSON.parse(val)
    return true
  } catch {
    return 'Invalid JSON'
  }
}

// auto-save with debounce
if (props.autoSave) {
  const doSave = lodashDebounce(() => {
    // only emit when valid
    try {
      const parsed = JSON.parse(jsonString.value)
      emit('update:modelValue', parsed)
    } catch {
      // skip invalid
    }
  }, props.debounce)

  watch(jsonString, () => {
    doSave()
  })
}

// manual save
const onSave = () => {
  try {
    const parsed = JSON.parse(jsonString.value)
    emit('update:modelValue', parsed)
  } catch {
    q.notify({
      color: 'negative',
      position: 'top',
      message: 'Invalid JSON format',
      icon: 'report_problem',
    })
  }
}

// auto-format on blur
const onBlur = () => {
  try {
    jsonString.value = JSON.stringify(JSON.parse(jsonString.value), null, 2)
  } catch {
    // leave as-is if invalid
  }
}
</script>
