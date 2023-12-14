<template>
  <div class="row items-center">
    <div class="col">
      <q-btn
        class="fit"
        label="Login to Openrouter.ai service"
        icon="key"
        noCaps
        outline
        @click="onGetOpenRouterKey"
      >
      </q-btn>
    </div>
    <div class="col-auto">
      <InfoDialog
        info-text="
www.openrouter.ai is a service which brings you a large number of AI
models: Once registered you have access to a large number of models:

- The free mistral model 
- All OpenAI Models including ChatGPT4 
- LLama2 
- ... and a lot more!"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, computed } from 'vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { useRoute } from 'vue-router';
import InfoDialog from 'components/InfoDialog.vue';

const state = useTaskyonStore();
const route = useRoute();

const callbackUrl = window.location.origin; // This will get the base URL of your application

const authURL = computed(() => {
  console.log('get current URL');
  return `https://openrouter.ai/auth?callback_url=${encodeURIComponent(
    callbackUrl
  )}`;
});

function onGetOpenRouterKey() {
  delete state.keys['openrouter.ai'];
  window.location.href = authURL.value;
}

async function checkForApiKey() {
  const code = route.query['code'] as string | undefined;
  if (code) {
    console.log('found code in URL:', code);
    await state.getOpenRouterPKCEKey(code);
  }
}

onMounted(() => {
  void checkForApiKey();
});
</script>
