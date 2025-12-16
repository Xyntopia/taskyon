<template>
  <q-splitter v-model="splitterPosition">
    <!-- Left pane: main app content -->
    <template #before>
      <slot name="before"></slot>
    </template>

    <!-- Right pane: placeholder that defines geometry for Taskyon -->
    <template #after>
      <slot name="after"></slot>
    </template>
  </q-splitter>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const splitterPosition = ref(50)
</script>
