<!-- ResponsiveMenuDialog.vue -->
<template>
  <div @click.stop>
    <!-- Always render a button -->
    <q-btn v-bind="$attrs" @click="open = true">
      <q-tooltip> <slot name="tooltip" /></q-tooltip>
      <!-- Desktop: menu anchored to the button -->
      <q-menu v-if="!$q.platform.is.mobile" auto-close>
        <slot />
      </q-menu>
      <!-- Mobile: dialog (bottom sheet style) -->
      <q-dialog
        v-else
        v-model="open"
        transition-show="slide-up"
        transition-hide="slide-down"
        auto-close
        :maximized="maximized"
      >
        <q-card>
          <slot />
        </q-card>
      </q-dialog>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { type QDialog } from 'quasar'
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

defineProps<{
  maximized?: QDialog['maximized']
}>()

const open = ref(false)
</script>
