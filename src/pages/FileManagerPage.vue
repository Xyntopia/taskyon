<template>
  <q-page padding>
    <StorageManager
      :storage-client="taskyon.storageClient"
      initial-namespace="modelica/projects"
      show-physical
    />
  </q-page>
</template>

<script setup lang="ts">
import StorageManager from '@taskyon/ui/components/StorageManager.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'

defineProps<{ initialPath?: string | string[] }>()

const taskyon = useTaskyonStore()
</script>
