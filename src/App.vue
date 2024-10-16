<template>
  <router-view />
</template>

<script setup lang="js">
// we are using lang=js here in order to integrate g analytics
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { generateTaskyonMeta } from './modules/meta';
import { useMeta } from 'quasar';

const route = useRoute();

if (process.env.DEV) {
  // Dynamically inject script src="http://localhost:8098" in DEV mode
  onMounted(() => {
    const devScript = document.createElement('script');
    devScript.async = true;
    devScript.src = 'http://localhost:8098'; // Adjust the URL if needed
    document.head.appendChild(devScript);
  });
}

watch(
  () => route.fullPath,
  () => {
    const meta = generateTaskyonMeta(route);
    useMeta(meta);
  },
);

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
