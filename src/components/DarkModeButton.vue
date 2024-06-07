<template>
  <q-btn
    dense
    flat
    round
    :icon="
      $q.dark.mode === 'auto'
        ? matContrast
        : $q.dark.mode
        ? matDarkMode
        : matLightMode
    "
    @click="toggleTheme"
    v-bind="$attrs"
  >
    <q-tooltip
      >Dark Mode:
      {{
        $q.dark.mode === 'auto' ? 'auto' : $q.dark.mode ? 'dark' : 'light'
      }}</q-tooltip
    >
  </q-btn>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar';

import {
  matContrast,
  matDarkMode,
  matLightMode,
} from '@quasar/extras/material-icons';

// Emits an event when the theme is changed
const emit = defineEmits<{
  themeChanged: [newMode: boolean | 'auto'];
}>();

const $q = useQuasar();

function toggleTheme() {
  const newMode =
    $q.dark.mode === 'auto' ? true : $q.dark.mode == true ? false : 'auto';
  $q.dark.set(newMode);
  emit('themeChanged', newMode);
}
</script>
