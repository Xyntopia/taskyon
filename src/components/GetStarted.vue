<template>
  <div class="welcome-message column items-center">
    <div
      class="text-h6 col-auto text-center"
      v-if="state.keys[state.llmSettings.selectedApi]"
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
        <div class="row items-center justify-center q-pb-lg">
          <q-icon
            class="q-pa-md col-auto"
            size="lg"
            name="svguse:taskyon_mono_opt.svg#taskyon"
          ></q-icon>
          <div class="col-auto column items-center">
            <div>No API key found for currently selected API:</div>
            <span class="text-weight-bolder q-pt-sm">{{
              state.llmSettings.selectedApi
            }}</span>
          </div>
        </div>
        <div
          v-if="Object.keys(state.keys).filter((k) => state.keys[k]).length"
          class="row items-center q-py-sm"
        >
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
                @click="state.llmSettings.selectedApi = keyname"
              />
            </div>
          </div>
        </div>
        <q-item-label header>Taskyon</q-item-label>
        <div class="row q-gutter-sm justify-center items-center">
          <q-btn
            class="col-5"
            outline
            noCaps
            label="Use free Taskyon"
            icon="svguse:taskyon_mono_opt.svg#taskyon"
            @click="
              state.llmSettings.selectedApi = 'taskyon';
              state.keys['taskyon'] = 'anonymous';
            "
          ></q-btn>
          <InfoDialog
            class="col-auto"
            info-text="Xyntopia Taskyon provides access to free LLM services for testing purposes."
          />
        </div>
        <q-item-label header>Or: Custom LLM Servers</q-item-label>
        <div class="row">
          <q-btn
            class="col"
            outline
            noCaps
            to="/settings/llmproviders"
            label="Manually provide settings for a custom LLM server"
            :icon="matSettings"
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
import { matSettings } from '@quasar/extras/material-icons';

const state = useTaskyonStore();
</script>
