<template>
  <codemirror
    v-model="content"
    placeholder="Code goes here..."
    :style="{ height: '400px', overflow: 'hidden', background: 'white' }"
    autofocus
    indent-with-tab
    :line-wrapping="true"
    :tab-size="2"
    :extensions="extensions"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useQuasar } from 'quasar'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { Codemirror } from 'vue-codemirror'

const content = defineModel<string>({
  required: true,
  default: '', // Default to an empty string
})

const $q = useQuasar()
const extensions = computed(() => {
  return $q.dark.isActive ? [basicSetup, javascript(), oneDark] : [basicSetup, javascript()]
  //return [];
})
</script>
