<!-- ResponsiveMenuDialogBtn.vue -->
<template>
  <div>
    <!-- Always render a button -->
    <q-btn v-bind="$attrs" @click="open = !open" @click.stop>
      <slot name="btnContent" />
    </q-btn>

    <ResponsiveMenuDialog
      v-model="open"
      :maximized="maximized"
      :data-cy="dataCyMenu"
      :auto-close="autoClose"
    >
      <template #default="{ close: innerClose }">
        <slot :close="innerClose" />
      </template>
    </ResponsiveMenuDialog>
  </div>
</template>

<script setup lang="ts">
import { type QMenu, type QDialog } from 'quasar'
import { ref } from 'vue'
import ResponsiveMenuDialog from './ResponsiveMenuDialog.vue'

defineOptions({ inheritAttrs: false })

defineProps<{
  maximized?: QDialog['maximized']
  dataCyMenu?: string
  autoClose?: QMenu['autoClose']
}>()

const open = ref(false)
</script>
