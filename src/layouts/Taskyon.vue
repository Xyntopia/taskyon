<template>
  <q-layout view="hHh LpR lfr">
    <q-header
      elevated
      :class="$q.dark.isActive ? 'bg-secondary' : 'bg-primary'"
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
        <q-btn-toggle
          dense
          outline
          :color="$q.dark.mode ? 'primary' : 'white'"
          :toggle-color="$q.dark.mode ? 'white' : 'secondary'"
          :model-value="$q.dark.mode"
          @update:modelValue="
            (value) => {
              $q.dark.set(value);
              state.darkTheme = value;
            }
          "
          label="Dark Theme"
          :options="[
            { label: 'Auto', value: 'auto' },
            { value: false, icon: 'light_mode' },
            { value: true, icon: 'dark_mode' },
          ]"
        >
          <q-tooltip :delay="500">Set dark/light theme</q-tooltip>
        </q-btn-toggle>
        <!-- GitHub Link -->
        <q-btn
          flat
          dense
          round
          icon="mdi-github"
          href="https://github.com/xyntopia/taskyon"
          target="_blank"
        >
          <q-tooltip :delay="500">Visit our GitHub</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="state.drawerOpen"
      show-if-above
      elevated
      :width="300"
      :breakpoint="800"
      bordered
      :class="[$q.dark.isActive ? 'bg-primary' : 'bg-grey-3']"
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
