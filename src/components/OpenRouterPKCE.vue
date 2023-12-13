<template>
  <div class="row items-center">
    <div class="col">
      <q-btn
        label="Login to Openrouter.ai service"
        icon="key"
        noCaps
        outline
        @click="onGetOpenRouterKey"
      >
      </q-btn>
    </div>
    <div class="col-auto">
      <q-btn flat rounded dense icon="info" @click="showInfo = true">
        <q-dialog v-model="showInfo">
          <q-card>
            <q-card-section>
              <QMarkdown
                src="
www.openrouter.ai is a service which brings you a large number of AI
models: Once registered you have access to a large number of models:

- The free mistral model 
- All OpenAI Models including ChatGPT4 
- LLama2 
- ... and a lot more!
        "
              />
            </q-card-section>
          </q-card>
        </q-dialog>
      </q-btn>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { useTaskyonStore } from 'src/stores/taskyonState';
import { useRoute } from 'vue-router';
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';

const state = useTaskyonStore();
const route = useRoute();
const showInfo = ref(false);

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
