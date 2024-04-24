<template>
  <codemirror
    v-model="content"
    placeholder="Code goes here..."
    :style="{ height: '400px' }"
    :autofocus="true"
    :indent-with-tab="true"
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

const content = defineModel<string | undefined>({
  required: true,
});

const $q = useQuasar();
const extensions = computed(() =>
  $q.dark.isActive ? [javascript(), oneDark] : [javascript()]
);
</script>
