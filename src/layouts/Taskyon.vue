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
        <!-- Home Icon Button -->
        <q-toolbar-title>
          <q-btn stretch dense flat to="/">
            <q-avatar text-color="red" class="q-mr-xs" size="md">
              <q-img src="~assets/taskyon.svg" />
            </q-avatar>
            <div>Taskyon</div>
          </q-btn>
        </q-toolbar-title>
        <q-btn flat dense round icon="settings" to="settings">
          <q-tooltip>Open settings</q-tooltip>
        </q-btn>
        <q-btn
          dense
          flat
          round
          :icon="
            $q.dark.mode === 'auto'
              ? 'contrast'
              : $q.dark.mode
              ? 'dark_mode'
              : 'light_mode'
          "
          @click="
            () => {
              const newMode =
                $q.dark.mode === 'auto'
                  ? true
                  : $q.dark.mode == true
                  ? false
                  : 'auto';
              state.darkTheme = newMode;
              $q.dark.set(newMode);
            }
          "
        >
          <q-tooltip
            >Theme:
            {{
              $q.dark.mode === 'auto' ? 'auto' : $q.dark.mode ? 'dark' : 'light'
            }}</q-tooltip
          >
        </q-btn>
        <q-separator vertical></q-separator>
        <!-- GitHub Link -->
        <q-btn
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

<script setup lang="ts">
import ChatSidebar from 'components/ChatSidebar.vue';
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();
</script>
