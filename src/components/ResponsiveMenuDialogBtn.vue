<!-- ResponsiveMenuDialogBtn.vue -->
<template>
  <div @click.stop>
    <!-- Always render a button -->
    <q-btn v-bind="$attrs" @click="open = true">
      <slot name="btnContent" />
      <!-- Desktop: menu anchored to the button -->
      <ResponsiveMenuDialog
        v-model="open"
        :maximized="maximized"
        :data-cy="dataCy"
        :auto-close="autoClose"
      >
        <slot />
      </ResponsiveMenuDialog>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { type QMenu, type QDialog } from 'quasar'
import { ref } from 'vue'
import ResponsiveMenuDialog from './ResponsiveMenuDialog.vue'

defineOptions({ inheritAttrs: false })

defineProps<{
  maximized?: QDialog['maximized']
  dataCy?: string
  autoClose?: QMenu['autoClose']
}>()

const open = ref(false)
</script>
