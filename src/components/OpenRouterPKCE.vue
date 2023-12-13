<template>
  <q-btn label="Get OpenRouter API Key" :to="authURL"></q-btn>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useTaskyonStore } from 'src/stores/taskyonState';

const store = useTaskyonStore();
const $q = useQuasar();

const authURL = computed(() => {
  // TODO: get current URL using vue3 router
});

const checkForApiKey = () => {
  //TODO: use vue router to get the resulting API key
  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('api_key');
  if (apiKey) {
    // Store the API key
    store.keys['openrouter.ai'] = apiKey;
    $q.notify('API Key retrieved successfully');
  }
};

onMounted(() => {
  checkForApiKey();
});
</script>
