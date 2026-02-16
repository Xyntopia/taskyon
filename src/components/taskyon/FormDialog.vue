<template>
  <q-btn v-bind="$attrs" @click="() => (openDialog = true)" />
  <q-dialog v-model="openDialog" auto-close>
    <!--prevent clicks from closing the dialog...-->
    <q-card @click.stop>
      <q-card-section v-if="title" class="text-h6"> {{ title }}</q-card-section>
      <q-card-section v-if="$slots.before">
        <slot name="before" />
      </q-card-section>
      <q-card-section>
        <ObjectView v-model="reactiveData" :schema="schema" :dense="!!denseOptions" />
      </q-card-section>
      <q-card-section v-if="$slots.after">
        <slot name="after" />
      </q-card-section>
      <q-card-actions class="float-right">
        <q-btn v-close-popup flat label="Ok" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { type JSONSchema7 } from 'json-schema'
import { ref } from 'vue'
import type z from 'zod'
import ObjectView from '../varViews/ObjectView.vue'

defineOptions({ inheritAttrs: false })

const openDialog = ref(false)
const reactiveData = defineModel<Record<string, unknown>>()

defineProps<{
  title?: string
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined
  denseOptions?: boolean
}>()
</script>
