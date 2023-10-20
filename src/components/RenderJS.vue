<template>
    <div>
      <iframe ref="sandbox" :srcdoc="sanitizedContent" frameborder="0"></iframe>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted, watch } from 'vue';
  import DOMPurify from 'dompurify';
  
  // Prop to accept the HTML + JavaScript string
  const content = ref('<h1>Hello World</h1><script>alert("Hello World");</script>');
  
  const sanitizedContent = ref('');
  
  // Watch for changes to content and sanitize it
  watch(content, (newContent) => {
    sanitizedContent.value = DOMPurify.sanitize(newContent, { ADD_TAGS: ['script'] });
  });
  
  const sandbox = ref(null);
  
  onMounted(() => {
    // Ensure iframe is sandboxed, but allow scripts
    sandbox.value.setAttribute('sandbox', 'allow-scripts');
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
  