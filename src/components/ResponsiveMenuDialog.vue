<!-- ResponsiveMenuDialogBtn.vue -->
<template>
  <q-menu v-if="!$q.platform.is.mobile" :auto-close="autoClose" :data-cy="dataCy">
    <slot />
  </q-menu>
  <!-- Mobile: dialog (bottom sheet style) -->
  <q-dialog
    v-else
    v-model="open"
    transition-show="slide-up"
    transition-hide="slide-down"
    :auto-close="autoClose"
    :maximized="maximized"
  >
    <q-card :data-cy="dataCy">
      <slot />
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { type QMenu, type QDialog } from 'quasar'

defineOptions({ inheritAttrs: false })

const open = defineModel<boolean>({ default: false })

defineProps<{
  maximized?: QDialog['maximized']
  dataCy?: string | undefined
  autoClose?: QMenu['autoClose']
}>()
</script>
