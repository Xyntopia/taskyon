<template>
  <q-btn v-bind="$attrs" @click.stop="showDialog = true">
    <slot name="btn"></slot>
  </q-btn>
  <q-dialog v-model="showDialog" auto-close>
    <slot :close="() => (showDialog = false)"></slot>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const showDialog = ref(false)
</script>
