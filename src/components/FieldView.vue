<template>
  <div class="row q-gutter-sm items-center">
    <q-icon v-if="item.icon" size="sm" :name="item.icon"></q-icon>
    <div v-if="item.label" class="col-auto" style="min-width: 200px">
      {{ item.label }}:
      <q-btn
        v-if="item.default"
        color="grey-4"
        dense
        size="sm"
        flat
        :icon="matRestartAlt"
        @click="emit('reset')"
      >
        <q-tooltip>Reset to default</q-tooltip>
      </q-btn>
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

defineProps<{
  item: {
    icon?: string
    description?: string
    label?: string
    default?: unknown
  }
}>()
</script>
