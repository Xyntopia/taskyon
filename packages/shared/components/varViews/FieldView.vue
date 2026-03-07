<template>
  <div class="row q-gutter-sm items-center justify-between">
    <div
      v-if="(item.label && showLabel) || reset"
      class="col-auto row items-center"
      :style="item.label && showLabel ? 'min-width: 200px' : ''"
    >
      <q-icon v-if="item.icon" size="sm" class="q-pr-sm" :name="item.icon" />
      <div v-else class="gt-xs q-mr-sm" style="min-width: 24px" />
      <template v-if="item.label && showLabel">{{ item.label }}:</template>

      <template v-if="reset">
        <q-btn
          v-if="item.default !== undefined"
          dense
          size="sm"
          flat
          :icon="matRestartAlt"
          @click.stop="emit('reset')"
        >
          <q-tooltip>Reset to default</q-tooltip>
        </q-btn>
      </template>

      <q-btn v-if="copy" dense size="sm" flat :icon="matContentCopy" @click.stop="emit('copy')">
        <q-tooltip>Copy value as JSON</q-tooltip>
      </q-btn>

      <slot name="header-extra" />
    </div>

    <template v-if="item.description">
      <InfoDialog class="lt-sm col-auto" :info-text="item.description" />
    </template>

    <div class="col-grow row" :data-cy="item.label">
      <div class="col" style="flex: 1 0 auto">
        <slot />
      </div>
      <div v-if="item.description" class="gt-xs col-auto obj-info">
        <InfoDialog :info-text="item.description" />
      </div>
      <div v-else style="width: 33.6px" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { matRestartAlt, matContentCopy } from '@quasar/extras/material-icons'
import InfoDialog from '../InfoDialog.vue'

const emit = defineEmits<{
  (e: 'reset'): void
  (e: 'copy'): void
}>()

defineProps<{
  showLabel?: boolean
  reset?: boolean
  copy?: boolean
  item: {
    icon?: string
    description?: string
    label?: string
    default?: unknown
  }
}>()
</script>
