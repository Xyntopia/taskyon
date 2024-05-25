<template>
  <div class="welcome-message column items-center q-pa-xl">
    <div
      class="text-h6 col-auto text-center"
      v-if="state.keys[state.chatState.selectedApi]"
    >
      <q-icon
        class="q-pa-xl"
        size="10rem"
        name="svguse:taskyon_mono_opt.svg#taskyon"
      ></q-icon>
      <p>Welcome! Just type a message below to start using Taskyon!</p>
    </div>
    <div v-else class="col-auto text-body1">
      <!--API Key hint-->
      <q-card-section class="column">
        <p>
          No API key found for currently selected API:
          <span class="text-weight-bolder q-pa-md">{{
            state.chatState.selectedApi
          }}</span
          >.
        </p>
        <div class="row items-center">
          <p class="col-auto col-sm">
            Choose one of the following APIs that are already ready for use:
          </p>
          <div class="col row q-gutter-sm q-px-md">
            <div
              v-for="keyname of Object.keys(state.keys).filter(
                (k) => state.keys[k]
              )"
              :key="keyname"
              class="col-auto"
            >
              <q-btn
                :label="keyname"
                color="secondary"
                @click="state.chatState.selectedApi = keyname"
              />
            </div>
          </div>
        </div>
        <q-item-label header>Custom LLM Servers</q-item-label>
        <div class="row">
          <q-btn
            class="col"
            outline
            noCaps
            to="/settings/llmproviders"
            label="Manually provide settings for a custom LLM server"
            icon="settings"
          ></q-btn>
          <InfoDialog
            info-text="Examples are:  setup a local, privacy-presevering server, A custom LLM AI server in your company etc..."
          />
        </div>
        <q-item-label header>More Options</q-item-label>
        <OpenRouterPKCE />
        <div class="row">
          <q-btn
            class="col"
            label="Go to OpenAI to retrieve an API key from OpenAI (not recommended)"
            outline
            noCaps
            href="https://platform.openai.com/account/api-keys"
            target="_blank"
          />
          <InfoDialog
            info-text="You can also get an API key from https://openrouter.ai/keys and manually insert into the settings."
          />
        </div>
        <div class="row">
          <q-btn
            class="col"
            label="Access keys via OpenRouter Dashboard (not recommended)"
            outline
            noCaps
            href="https://openrouter.ai/keys"
            target="_blank"
          />
          <InfoDialog
            info-text="Get an API key from https://www.openrouter.ai and use it for inference tasks"
          />
        </div>
      </q-card-section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';
import OpenRouterPKCE from 'src/components/OpenRouterPKCE.vue';
import InfoDialog from 'src/components/InfoDialog.vue';

const state = useTaskyonStore();
</script>
