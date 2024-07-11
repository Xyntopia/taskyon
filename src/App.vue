<template>
  <router-view />
</template>

<script setup lang="js">
// we are using lang=js here in order to integrate g analytics
import { onMounted } from 'vue';

defineOptions({
  name: 'App',
});

if (process.env.DEV) {
  onMounted(() => {
    // we are doing this, specifically for testing purposes...
    // although it doesn't really seem to work for cypress
    dispatchEvent(new Event('load'));
  });
}
</script>
