<template>
  <div class="activity-row row no-wrap items-start q-py-sm">
    <q-icon :name="icon" :color="color" size="18px" class="q-mr-sm q-mt-xs" />
    <div class="col">
      <div class="text-body2">{{ entry.label }}</div>
      <div v-if="entry.message || entry.error" class="text-caption text-grey-7">
        {{ entry.error ?? entry.message }}
      </div>
      <q-linear-progress
        v-if="entry.status === 'running'"
        :indeterminate="entry.total === undefined"
        :value="progress"
        color="warning"
        class="q-mt-xs"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ActivityEntry } from '@taskyon/common/modules/activity'
import { computed } from 'vue'

const props = defineProps<{ entry: ActivityEntry }>()
const icon = computed(() =>
  props.entry.status === 'running'
    ? 'sync'
    : props.entry.status === 'error'
      ? 'error_outline'
      : 'check_circle',
)
const color = computed(() =>
  props.entry.status === 'running'
    ? 'warning'
    : props.entry.status === 'error'
      ? 'negative'
      : 'positive',
)
const progress = computed(() =>
  props.entry.total === undefined || props.entry.completed === undefined
    ? 0
    : props.entry.completed / Math.max(1, props.entry.total),
)
</script>
