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
      Welcome to Taskyon! To get started you need to add your API keys to an LLM
      in the settings!
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();
</script>
