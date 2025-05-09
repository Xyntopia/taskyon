<template>
  <q-btn @click="() => (openDialog = true)" v-bind="$attrs" />
  <q-dialog v-model="openDialog" auto-close>
    <q-card>
      <q-card-section>
        <ObjectTreeView v-model="reactiveData" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObjectTreeView from '../ObjectTreeView.vue'

defineOptions({ inheritAttrs: false })

const openDialog = ref(false)
const reactiveData = defineModel<Record<string, unknown>>()
</script>
