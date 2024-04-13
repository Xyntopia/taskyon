<template>
  <q-layout view="hHh LpR lfr">
    <q-header
      elevated
      :class="[$q.dark.isActive ? 'bg-secondary' : 'bg-primary', 'print-hide']"
    >
      <q-toolbar class="q-gutter-xs">
        <q-btn
          flat
          @click="state.drawerOpen = !state.drawerOpen"
          round
          dense
          icon="menu"
        />
        <q-separator vertical :dark="!$q.dark.isActive"></q-separator>
        <q-btn flat round dense to="/taskmanager">
          <q-icon name="search"></q-icon>
          <q-tooltip>Search Conversations</q-tooltip>
        </q-btn>
        <q-btn flat round dense icon="chat" to="/"
          ><q-tooltip>Go to Chat</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          icon="reviews"
          to="/"
          @click="state.chatState.selectedTaskId = undefined"
          ><q-tooltip>Create New Chat</q-tooltip>
        </q-btn>
        <q-space />
        <q-icon class="desktop-only" size="sm" name="svguse:taskyon_mono_opt.svg#taskyon"></q-icon>
        <q-space />
        <q-btn
          v-if="errors.length > 0"
          flat
          dense
          round
          color="warning"
          icon="warning"
          to="diagnostics"
        >
          <q-tooltip
            >There was problem with taskyon!, click here to find out
            more..</q-tooltip
          >
        </q-btn>
        <q-btn flat dense round icon="settings" to="settings">
          <q-tooltip>Open settings</q-tooltip>
        </q-btn>
        <dark-mode-button
          @theme-changed="(newMode) => (state.darkTheme = newMode)"
        />
        <q-separator vertical></q-separator>
        <!-- GitHub Link -->
        <q-btn
          class="desktop-only"
          flat
          dense
          round
          icon="mdi-github"
          href="https://github.com/xyntopia/taskyon"
          target="_blank"
        >
          <q-tooltip>Visit our GitHub</q-tooltip>
        </q-btn>
      </q-toolbar>
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
import { errors } from 'boot/taskyon';

const state = useTaskyonStore();
</script>
