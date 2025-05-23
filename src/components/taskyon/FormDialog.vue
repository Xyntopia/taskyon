<template>
  <q-btn @click="() => (openDialog = true)" v-bind="$attrs" />
  <q-dialog v-model="openDialog" auto-close>
    <!--prevent clicks from closing the dialog...-->
    <q-card @click.stop>
      <q-card-section v-if="title" class="text-h6"> {{ title }}</q-card-section>
      <q-card-section v-if="$slots.before">
        <slot name="before" />
      </q-card-section>
      <q-card-section>
        <ObjectTreeView v-model="reactiveData" :schema="schema" />
      </q-card-section>
      <q-card-section v-if="$slots.after">
        <slot name="after" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObjectTreeView from '../ObjectTreeView.vue'
import { type JSONSchema7 } from 'json-schema'
import type z from 'zod'

defineOptions({ inheritAttrs: false })

const openDialog = ref(false)
const reactiveData = defineModel<Record<string, unknown>>()

defineProps<{ title?: string; schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined }>()
</script>
