<template>
  <DialogButton flat dense round :icon="matHelpOutline" v-bind="$attrs">
    <q-card>
      <q-card-section>
        <TyMarkdown v-if="infoText" :src="infoText" />
        <slot></slot>
      </q-card-section>
    </q-card>
  </DialogButton>
</template>

<script setup lang="ts">
import { matHelpOutline } from '@quasar/extras/material-icons'
import TyMarkdown from './tyMarkdown.vue'
import DialogButton from './DialogButton.vue'
defineProps({
  infoText: {
    type: String,
    required: false,
    default: undefined,
  },
})
</script>
