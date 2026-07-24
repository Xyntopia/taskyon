<template>
  <q-btn v-bind="$attrs" @click.stop="showDialog = true">
    <slot name="btn"></slot>
  </q-btn>
  <q-dialog v-model="showDialog" :auto-close="autoClose">
    <slot :close="() => (showDialog = false)"></slot>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const { autoClose = true } = defineProps<{
  autoClose?: boolean
}>()
const showDialog = ref(false)
</script>
