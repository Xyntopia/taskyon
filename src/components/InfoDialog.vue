<template>
  <q-btn flat dense round :icon="matHelpOutline" v-bind="$attrs" @click.stop="showInfo = true" />
  <q-dialog v-model="showInfo">
    <q-card>
      <q-card-section>
        <TyMarkdown v-if="infoText" :src="infoText" />
        <slot></slot>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const showInfo = ref(false)
import { matHelpOutline } from '@quasar/extras/material-icons'
import TyMarkdown from './tyMarkdown.vue'
defineProps({
  infoText: {
    type: String,
    required: false,
    default: undefined,
  },
})
</script>
