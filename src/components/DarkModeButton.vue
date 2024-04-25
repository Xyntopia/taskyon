<template>
  <q-btn
    dense
    flat
    round
    :icon="
      $q.dark.mode === 'auto'
        ? 'contrast'
        : $q.dark.mode
        ? 'dark_mode'
        : 'light_mode'
    "
    @click="toggleTheme"
    v-bind="$attrs"
  >
    <q-tooltip
      >Theme:
      {{
        $q.dark.mode === 'auto' ? 'auto' : $q.dark.mode ? 'dark' : 'light'
      }}</q-tooltip
    >
  </q-btn>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar';

// Emits an event when the theme is changed
const emit = defineEmits(['themeChanged']);

const $q = useQuasar();

function toggleTheme() {
  const newMode =
    $q.dark.mode === 'auto' ? true : $q.dark.mode == true ? false : 'auto';
  $q.dark.set(newMode);
  emit('themeChanged', newMode);
}
</script>
