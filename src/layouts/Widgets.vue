<template>
  <q-layout view="hHh Lpr fFf">
    <q-header class="row items-center">
      <!-- Be sure to play with the Layout demo on docs -->
      <q-btn
        flat
        @click="drawerOpen = !drawerOpen"
        dense
        :icon="matMenu"
        :size="btnsize"
      />
      <q-separator vertical :dark="!$q.dark.isActive"></q-separator>
      <q-btn
        flat
        dense
        :size="btnsize"
        :icon="matReviews"
        to="/"
        @click="state.llmSettings.selectedTaskId = undefined"
        ><q-tooltip>Create New Chat</q-tooltip>
      </q-btn>
      <q-space />
      <q-btn
        v-if="state.getErrors().length > 0"
        flat
        dense
        round
        color="warning"
        :icon="matWarning"
        to="diagnostics"
      >
        <q-tooltip
          >There was problem with taskyon!, click here to find out
          more..</q-tooltip
        >
      </q-btn>
      <dark-mode-button
        :size="btnsize"
        @theme-changed="(newMode) => (state.darkTheme = newMode)"
      />

      <q-btn
        flat
        dense
        size="xs"
        icon="svguse:taskyon_mono_opt.svg#taskyon"
        type="a"
        href="/chat"
        target="_blank"
      />
      <q-btn
        flat
        dense
        size="xs"
        :icon="matLaunch"
        color="grey-6"
        type="a"
        href="http://www.xyntopia.com"
        target="_blank"
        aria-label="Visit Xyntopia"
      />
      <!--<q-img width="30px" src="~assets/xyntopia.svg" />-->
    </q-header>
    <q-page-container>
      <!-- This is where pages get injected we do row & items-stretch in order for our widgets to fill the entire iframe..-->
      <q-page>
        <router-view />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
//TODO: change colors based on the route...
import { useRoute } from 'vue-router';
const route = useRoute();
route.query; //has all the parameters :)

import DarkModeButton from 'components/DarkModeButton.vue';
import { ref } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import {
  matLaunch,
  matMenu,
  matReviews,
  matWarning,
} from '@quasar/extras/material-icons';

const state = useTaskyonStore();
const btnsize = 'xs';
const drawerOpen = ref(false);
</script>
