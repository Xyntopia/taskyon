<template>
  <div class="welcome-message column items-center q-pa-xl">
    <div class="col-auto">
      <q-icon
        class="q-pa-xl"
        size="10rem"
        name="svguse:taskyon_mono_opt.svg#taskyon"
      ></q-icon>
      <!--<q-img
	            width="150px"
	            alt="Quasar logo"
	            src="~assets/taskyon_mono.svg"
	          ></q-img>-->
    </div>
    <div
      class="text-h6 col-auto text-center"
      v-if="state.keys[state.chatState.selectedApi]"
    >
      Welcome! Just type a message below to start using Taskyon!
    </div>
    <div v-else class="text-h6 col-auto text-center">
      <!--API Key hint-->
      <q-card-section class="q-gutter-md column">
        <p>
          No API key found for currently selected API:
          <span class="text-bold">{{ state.chatState.selectedApi }}</span>
          . Either choose a different API by pressing one of the following
          buttons:
        </p>
        <div class="self-center q-gutter-md">
          <q-btn
            v-for="keyname of Object.keys(state.keys).filter(
              (k) => state.keys[k]
            )"
            :key="keyname"
            :label="keyname"
            color="secondary"
            @click="state.chatState.selectedApi = keyname"
          />
        </div>
        <p>Or Generate a new API key in various ways:</p>
        <OpenRouterPKCE />
        <q-item-label header>More Options (not recommended)</q-item-label>
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
      <q-card-section>
        If getting keys manually or for your own server, add them to settings
        here: The server must be compatible with OpenAI API.
        <q-btn
          class="q-mx-sm"
          dense
          to="/settings/llmproviders"
          label="settings"
          icon="settings"
        ></q-btn>
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
