<template>
  <q-page padding>
    <StorageManager
      :storage-client="taskyon.storageClient"
      :initial-namespace="initialNamespace"
      :initial-object-kind="initialObjectKind"
      :initial-object-id="initialObjectId"
      show-physical
    />
  </q-page>
</template>

<script setup lang="ts">
import StorageManager from '@taskyon/ui/components/StorageManager.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { useRoute } from 'vue-router'

defineProps<{ initialPath?: string | string[] }>()

const taskyon = useTaskyonStore()
const route = useRoute()
const initialNamespace =
  typeof route.query.namespace === 'string' ? route.query.namespace : 'tool-files'
const initialObjectKind = route.query.kind === 'record' ? 'record' : 'blob'
const initialObjectId = typeof route.query.id === 'string' ? route.query.id : undefined
</script>
