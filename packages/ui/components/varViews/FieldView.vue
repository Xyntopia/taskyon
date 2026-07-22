<template>
  <div
    class="row q-gutter-sm items-center justify-between"
    :class="{ 'field-view--documentation': descriptionInline }"
  >
    <div
      v-if="(item.label && showLabel) || reset"
      class="col-auto row items-center"
      :style="item.label && showLabel ? 'min-width: 200px' : ''"
    >
      <q-icon v-if="item.icon" size="sm" class="q-pr-sm" :name="item.icon" />
      <div v-else class="gt-xs q-mr-sm" style="min-width: 24px" />
      <template v-if="item.label && showLabel">
        {{ item.label
        }}<span v-if="item.optional" class="text-secondary">?<q-tooltip>Optional</q-tooltip></span
        >:
      </template>

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

    <template v-if="item.description && !descriptionInline">
      <InfoDialog class="lt-sm col-auto" :info-text="item.description" />
    </template>

    <div class="col-grow row" :data-cy="item.label">
      <div class="col" style="flex: 1 0 auto">
        <div v-if="descriptionInline && item.description" class="text-caption text-grey-7">
          {{ item.description }}
        </div>
        <slot v-else />
      </div>
      <div v-if="item.description && !descriptionInline" class="gt-xs col-auto obj-info">
        <InfoDialog :info-text="item.description" />
      </div>
      <div v-else-if="!descriptionInline" style="width: 33.6px" />
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
  descriptionInline?: boolean
  item: {
    icon?: string
    description?: string
    label?: string
    default?: unknown
    optional?: boolean
  }
}>()
</script>

<style scoped lang="sass">
@media (max-width: 600px)
  .field-view--documentation
    align-items: flex-start
    flex-wrap: wrap

  .field-view--documentation > .col-grow
    flex-basis: 100%
</style>
