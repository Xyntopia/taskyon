<template>
  <codemirror
    v-model="content"
    placeholder="Code goes here..."
    :style="{ height: '400px', overflow: 'hidden' }"
    autofocus
    indent-with-tab
    :line-wrapping="true"
    :tab-size="2"
    :extensions="extensions"
    @change="console.log('change', $event)"
    @focus="console.log('focus', $event)"
    @blur="console.log('blur', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Codemirror } from 'vue-codemirror';
import { basicSetup } from 'codemirror';

const content = defineModel<string | undefined>({
  required: true,
});

const $q = useQuasar();
const extensions = computed(() => {
  return $q.dark.isActive
    ? [basicSetup, javascript(), oneDark]
    : [basicSetup, javascript()];
  //return [];
});
</script>
