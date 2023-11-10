<template>
  <q-layout view="hHh LpR lfr">
    <q-header
      elevated
      :class="$q.dark.isActive ? 'bg-secondary' : 'bg-primary'"
    >
      <q-toolbar>
        <q-btn
          flat
          @click="state.drawerOpen = !state.drawerOpen"
          round
          dense
          icon="menu"
        />
        <q-toolbar-title
          >Current Thread ID:
          {{ state.chatState.selectedTaskId }}</q-toolbar-title
        >
        <q-btn-toggle
          dense
          unelevated
          glossy
          color="primary"
          toggle-text-color="secondary"
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
import { useAppSettingsStore } from 'src/stores/appSettings';
import { useTaskyonStore } from 'stores/taskyonState';

const appSettings = useAppSettingsStore();
const state = useTaskyonStore();
</script>
