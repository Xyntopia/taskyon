<template>
  <q-btn @click="() => (openDialog = true)" v-bind="$attrs" />
  <q-dialog v-model="openDialog" auto-close>
    <q-card>
      <q-card-section v-if="title" class="text-h6"> {{ title }}</q-card-section>
      <q-card-section>
        <ObjectTreeView v-model="reactiveData" :schema="schema as JSONSchema7" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObjectTreeView from '../ObjectTreeView.vue'
import { type JSONSchema7 } from 'json-schema'
import type { JsonSchema7Type } from 'zod-to-json-schema'

defineOptions({ inheritAttrs: false })

const openDialog = ref(false)
const reactiveData = defineModel<Record<string, unknown>>()

defineProps<{ title?: string; schema?: JSONSchema7 | JsonSchema7Type | undefined }>()
</script>
