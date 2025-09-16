<!-- ResponsiveMenuDialog.vue -->
<template>
  <q-menu
    v-if="!$q.platform.is.mobile"
    v-model="open"
    :auto-close="autoClose"
    :data-cy="dataCy"
    :separate-close-popup="true"
    :touch-position="false"
    :target="target"
    no-parent-event
    :context-menu="contextMenu"
  >
    <slot :close="close" />
  </q-menu>
  <!-- Mobile: dialog (bottom sheet style) -->
  <q-dialog
    v-else
    v-model="open"
    transition-show="slide-up"
    transition-hide="slide-down"
    :auto-close="autoClose"
    :maximized="maximized"
    position="bottom"
  >
    <q-card v-touch-swipe.mouse.down="close" :data-cy="dataCy">
      <slot :close="close" />
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { type QMenu, type QDialog } from 'quasar'

defineOptions({ inheritAttrs: false })

const open = defineModel<boolean>({ default: false })

const close = () => {
  open.value = false
}

defineProps<{
  maximized?: QDialog['maximized']
  dataCy?: string | undefined
  autoClose?: QMenu['autoClose']
  target?: QMenu['target']
  contextMenu?: QMenu['contextMenu']
}>()
</script>
