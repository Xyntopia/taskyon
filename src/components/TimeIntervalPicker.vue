<template>
  <div class="time-interval-picker">
    <q-input
      :model-value="modelValue / conversions[currentUnit]!"
      @update:model-value="updateSeconds"
      type="number"
      v-bind="$attrs"
    >
      <template v-slot:after>
        <q-select
          v-model="currentUnit"
          :options="unitOptions"
          dense
          emit-value
          borderless
          hide-dropdown-icon
          style="width: 70px"
        />
      </template>
    </q-input>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const unitOptions = [
  { label: 'sec', value: 'seconds' },
  { label: 'min', value: 'minutes' },
  { label: 'h', value: 'hours' },
  { label: 'd', value: 'days' },
  { label: 'm', value: 'months' },
  { label: 'y', value: 'years' },
]

const conversions: Record<string, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
  months: 86400 * 30,
  years: 86400 * 365,
}

// v-model binding as a ref
const { initialUnit = 'months' } = defineProps<{
  modelValue: number
  initialUnit?: keyof typeof conversions
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', seconds: number): void
}>()

function updateSeconds(timeUnits: string | number | null) {
  console.log('picker', Number(timeUnits) * conversions[currentUnit.value]!)
  return emit('update:modelValue', Number(timeUnits) * conversions[currentUnit.value]!)
}
const currentUnit = ref<string>(initialUnit)

// react to external changes
/*watch(modelValue, (secs = 0) => {
  displayValue.value = secs
})*/
</script>
