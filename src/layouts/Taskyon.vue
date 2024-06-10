<template>
  <q-layout view="lHh LpR lfr">
    <q-header elevated class="bg-primary print-hide">
      <component
        :is="!minMode ? 'q-toolbar' : 'div'"
        :class="minMode ? 'q-gutter-xs row q-px-sm' : 'q-gutter-xs'"
      >
        <q-btn
          v-if="state && !state.drawerOpen"
          flat
          @click="state.drawerOpen = !state.drawerOpen"
          round
          dense
          :size="btnSize"
          :icon="matMenu"
          aria-label="Open Sidebar"
        />
        <div v-if="state" class="q-ml-lg button-group">
          <q-btn
            v-if="!minMode"
            flat
            dense
            :size="btnSize"
            :icon="matSearch"
            to="/taskmanager"
            aria-label="go to taskmanager"
          >
            <q-tooltip>Search Conversations</q-tooltip>
          </q-btn>
          <q-btn
            v-if="!minMode"
            flat
            dense
            :icon="matChat"
            to="/"
            :size="btnSize"
            aria-label="go to chat"
            ><q-tooltip>Go to Chat</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            :icon="matAddComment"
            :size="btnSize"
            to="/"
            @click="state.llmSettings.selectedTaskId = undefined"
            aria-label="start new chat"
            ><q-tooltip>Create New Chat</q-tooltip>
          </q-btn>
        </div>
        <q-space />
        <q-btn
          v-if="state && state.getErrors().length > 0"
          flat
          dense
          round
          :size="btnSize"
          color="warning"
          :icon="matWarning"
          to="/diagnostics"
        >
          <q-tooltip
            >There was problem with taskyon!, click here to find out
            more..</q-tooltip
          >
        </q-btn>
        <q-btn
          v-if="!minMode"
          flat
          :size="btnSize"
          dense
          round
          :icon="matSettings"
          to="/settings"
        >
          <q-tooltip>Open settings</q-tooltip>
        </q-btn>
        <dark-mode-button
          v-if="state"
          :size="btnSize"
          @theme-changed="(newMode) => (state!.darkTheme = newMode)"
        />
        <q-separator
          v-if="!minMode"
          class="desktop-only"
          vertical
          :color="$q.dark.isActive ? 'secondary' : 'white'"
        ></q-separator>
        <q-btn
          v-if="!minMode"
          round
          flat
          dense
          icon="svguse:taskyon_mono_opt.svg#taskyon"
        >
          <q-menu>
            <q-list dense>
              <q-item
                clickable
                v-ripple
                href="https://github.com/xyntopia/taskyon"
                target="_blank"
                exact
              >
                <q-item-section avatar>
                  <q-icon :name="mdiGithub" />
                </q-item-section>
                <q-item-section>Visit our Taskyon repository</q-item-section>
              </q-item>
              <q-item clickable v-ripple to="/pricing" exact>
                <q-item-section> Taskyon Pricing </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </component>
    </q-header>

    <q-drawer
      v-if="state"
      v-model="state.drawerOpen"
      elevated
      persistent
      :width="250"
      :breakpoint="800"
      :class="[$q.dark.isActive ? 'bg-primary' : 'bg-grey-3', 'print-hide']"
    >
      <ChatSidebar />
    </q-drawer>

    <!-- Sidebar Right -->
    <!--
    <q-drawer
      show-if-above
      side="right"
      v-model="state.drawerRight"
      bordered
      :width="200"
      :breakpoint="500"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-sm">
          <div v-for="n in 50" :key="n">Drawer {{ n }} / 50</div>
        </div>
      </q-scroll-area>
    </q-drawer>-->

    <!-- Main Content Area -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style>
.button-group {
  display: inline-block;
  border: 1px solid #fff; /* add white outline */
  border-radius: 5px; /* optional, to match the rounded-borders class */
}

@media print {
  /* Hide everything initially */
  body * {
    visibility: hidden;
  }

  /* Only display the q-page and its children */
  .q-page,
  .q-page * {
    visibility: visible;
  }

  /* Override the page container padding for print */
  .q-page-container {
    padding: 0 !important;
  }

  .q-page {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    margin: 0;
    padding: 0;
    box-shadow: none; /* Remove shadows, if any */
    min-height: 0 !important; /* Override min-height if necessary */
  }
}
</style>

<script setup lang="ts">
import { ref } from 'vue';
import DarkModeButton from 'components/DarkModeButton.vue';
import { defineAsyncComponent } from 'vue';
import type { useTaskyonStore } from 'stores/taskyonState';
import {
  matAddComment,
  matChat,
  matMenu,
  matSearch,
  matSettings,
  matWarning,
} from '@quasar/extras/material-icons';
import { mdiGithub } from '@quasar/extras/mdi-v6';

const ChatSidebar = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "ChatSidebar" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'components/ChatSidebar.vue'
    )
);

//const state = useTaskyonStore();
let state = ref<undefined | ReturnType<typeof useTaskyonStore>>();

void import('stores/taskyonState').then(({ useTaskyonStore }) => {
  state.value = useTaskyonStore();
});

const minMode = state.value?.minimalGui || false;
const btnSize = minMode ? 'xs' : 'md';
</script>
