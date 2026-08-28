<template>
  <q-dialog v-model="open">
    <q-card class="about-dialog" data-cy="about-dialog">
      <q-card-section>
        <div class="text-h5" role="heading" aria-level="2">About {{ appName }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        {{ description }}
      </q-card-section>
      <q-card-actions v-if="$slots.actions" class="q-px-md">
        <slot name="actions" />
      </q-card-actions>
      <q-card-section class="about-dialog__environment text-info">
        <div
          v-for="entry in environmentEntries"
          :key="entry.name"
          class="about-dialog__environment-entry"
        >
          <span>{{ entry.name }}:</span>
          <span>{{ entry.value }}</span>
        </div>
      </q-card-section>
      <q-card-section v-if="$slots.legal">
        <slot name="legal" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'
import { computed } from 'vue'

defineSlots<{
  actions?: () => unknown
  legal?: () => unknown
}>()

defineProps<{
  appName: string
  description: string
}>()

const open = defineModel<boolean>({ required: true })
const environmentInfo = getEnvironmentInfo()

const formatEnvironmentValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'unknown'
  if (typeof value === 'object') return JSON.stringify(value) ?? 'unknown'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'symbol') return value.toString()
  return 'unknown'
}

const environmentEntries = computed(() => [
  { name: 'Commit hash', value: environmentInfo.commitHash },
  { name: 'Build date (UTC)', value: environmentInfo.publishDate.utc },
  { name: 'Build date (local)', value: environmentInfo.publishDate.local },
  ...Object.entries(environmentInfo)
    .filter(([name]) => name !== 'commitHash' && name !== 'publishDate')
    .map(([name, value]) => ({ name, value: formatEnvironmentValue(value) })),
])
</script>

<style scoped>
.about-dialog {
  width: min(620px, calc(100vw - 32px));
}

.about-dialog__environment {
  font-size: 0.75em;
}

.about-dialog__environment-entry {
  display: grid;
  grid-template-columns: minmax(150px, auto) 1fr;
  gap: 12px;
  overflow-wrap: anywhere;
}
</style>
