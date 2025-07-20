<template>
  <!--Field Wrapper-->
  <div class="row q-gutter-sm items-center">
    <q-icon v-if="item.icon" size="sm" :name="item.icon"></q-icon>
    <div
      v-if="(item.label && showLabel) || reset"
      class="col-auto row items-center"
      :style="item.label && showLabel ? 'min-width: 200px' : ''"
    >
      <template v-if="item.label && showLabel">{{ item.label }}:</template>
      <template v-if="reset">
        <q-btn
          v-if="item.default"
          dense
          size="sm"
          flat
          :icon="matRestartAlt"
          @click.stop="emit('reset')"
        >
          <q-tooltip>Reset to default</q-tooltip>
        </q-btn>
      </template>
    </div>
    <!--valueSlot-->
    <slot> </slot>
    <InfoDialog v-if="item.description" :info-text="item.description" />
  </div>
</template>

<script setup lang="ts">
import { matRestartAlt } from '@quasar/extras/material-icons'
import InfoDialog from 'components/InfoDialog.vue'

const emit = defineEmits<{
  (e: 'reset'): void
}>()

const { reset = true } = defineProps<{
  showLabel?: boolean
  reset?: boolean
  item: {
    icon?: string
    description?: string
    label?: string
    default?: unknown
  }
}>()
</script>
