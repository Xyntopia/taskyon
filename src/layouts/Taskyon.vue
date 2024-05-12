<template>
  <q-layout view="lHh LpR lfr">
    <q-header elevated class="bg-primary print-hide">
      <component
        :is="!minMode ? 'q-toolbar' : 'div'"
        :class="minMode ? 'q-gutter-xs row q-px-sm' : 'q-gutter-xs'"
      >
        <q-btn
          flat
          @click="state.drawerOpen = !state.drawerOpen"
          round
          dense
          :size="btnSize"
          icon="menu"
        />
        <div class="button-group">
          <q-btn
            v-if="!minMode"
            flat
            dense
            :size="btnSize"
            icon="search"
            to="/taskmanager"
          >
            <q-tooltip>Search Conversations</q-tooltip>
          </q-btn>
          <q-btn v-if="!minMode" flat dense icon="chat" to="/" :size="btnSize"
            ><q-tooltip>Go to Chat</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            icon="add_comment"
            :size="btnSize"
            to="/"
            @click="state.chatState.selectedTaskId = undefined"
            ><q-tooltip>Create New Chat</q-tooltip>
          </q-btn>
        </div>
        <q-space />
        <q-btn
          v-if="state.getErrors().length > 0"
          flat
          dense
          round
          :size="btnSize"
          color="warning"
          icon="warning"
          to="diagnostics"
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
          icon="settings"
          to="settings"
        >
          <q-tooltip>Open settings</q-tooltip>
        </q-btn>
        <dark-mode-button
          :size="btnSize"
          @theme-changed="(newMode) => (state.darkTheme = newMode)"
        />
        <q-separator
          v-if="!minMode"
          class="desktop-only"
          vertical
          :color="$q.dark.isActive ? 'secondary' : 'white'"
        ></q-separator>
        <q-btn
          v-if="!minMode"
          class="desktop-only"
          flat
          :size="btnSize"
          dense
          round
          icon="mdi-github"
          href="https://github.com/xyntopia/taskyon"
          target="_blank"
        >
          <q-tooltip>Visit our GitHub</q-tooltip>
        </q-btn>
      </component>
    </q-header>

    <q-drawer
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
import ChatSidebar from 'components/ChatSidebar.vue';
import DarkModeButton from 'components/DarkModeButton.vue';
import { useTaskyonStore } from 'stores/taskyonState';
const state = useTaskyonStore();
const minMode = state.minimalGui;
const btnSize = minMode ? 'xs' : 'md';
</script>
