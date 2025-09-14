<!-- ResponsiveMenuDialog.vue -->
<template>
  <div @click.stop>
    <!-- Always render a button -->
    <q-btn v-bind="$attrs" @click="open = true">
      <slot name="btnContent" />
      <!-- Desktop: menu anchored to the button -->
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
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { type QMenu, type QDialog } from 'quasar'
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

defineProps<{
  maximized?: QDialog['maximized']
  dataCy?: string
  autoClose?: QMenu['autoClose']
}>()

const open = ref(false)
</script>
