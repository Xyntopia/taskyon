<template>
  <q-layout>
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
          >Chat: Conversation
          {{ state.chatState.selectedTaskId }}</q-toolbar-title
        >
      </q-toolbar>
    </q-header>

    <ChatSidebar />

    <!-- Sidebar Right -->
    <q-drawer
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
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style lang="sass">
/* Define the CSS class for the orange "glow" shadow */
.not-assistant-message
  box-shadow: inset 0 0 5px $secondary
  border-radius: 5px
</style>

<script setup lang="ts">
import ChatSidebar from 'components/ChatSidebar.vue';
import { useAppSettingsStore } from 'src/stores/appSettings';
import { useTaskyonStore } from 'stores/taskyonState';

const appSettings = useAppSettingsStore();
const state = useTaskyonStore();
</script>
