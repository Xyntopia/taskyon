<template>
  <div>
    <iframe ref="sandbox" :srcdoc="content" frameborder="0"></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

// Prop to accept the HTML + JavaScript string
const content = ref<string>('<h1>Hello World</h1>' + '<script>alert("Hello World");<\/script>');

const sandbox = ref<HTMLIFrameElement | null>(null);

onMounted(() => {
  // Ensure iframe is sandboxed, but allow scripts
  if (sandbox.value) {
    sandbox.value.setAttribute('sandbox', 'allow-scripts');
  }
});
</script>

<style scoped>
/* Scoped styles for this component */
iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>

