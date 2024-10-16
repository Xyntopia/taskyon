<template>
  <q-layout view="lHh LpR lfr">
    <q-header class="column print-hide">
      <component
        :is="!minMode ? 'q-toolbar' : 'div'"
        :class="minMode ? 'q-gutter-xs row q-px-sm' : 'q-gutter-xs'"
      >
        <q-btn
          flat
          round
          dense
          :size="btnSize"
          :icon="matMenu"
          aria-label="Open Sidebar"
          @click="drawerOpen = !drawerOpen"
        />
        <div v-if="state" :class="['q-ml-lg', minMode ? '' : 'button-group']">
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
            :icon="mdiForum"
            to="/"
            :size="btnSize"
            aria-label="go to chat"
            ><q-tooltip>Go to Chat</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            :icon="mdiForumPlus"
            :size="btnSize"
            to="/"
            aria-label="start new chat"
            @click="state.llmSettings.selectedTaskId = undefined"
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
          v-if="$route.path == '/'"
          flat
          dense
          round
          :size="btnSize"
          :icon="matToc"
        >
          <q-menu>
            <table-of-chat-content></table-of-chat-content>
          </q-menu>
          <q-tooltip> Table of Contents </q-tooltip>
        </q-btn>
        <q-btn
          v-if="!minMode"
          flat
          class="gt-xs"
          dense
          round
          :size="btnSize"
          :icon="matHelpOutline"
          to="/docs/index"
        >
          <q-tooltip> Open Taskyon Documentation </q-tooltip>
        </q-btn>
        <q-separator
          v-if="!minMode"
          class="desktop-only"
          vertical
        ></q-separator>
        <q-btn
          v-if="!minMode"
          round
          flat
          dense
          icon="svguse:/taskyon_mono_opt.svg#taskyon"
        >
          <q-menu>
            <q-list dense>
              <q-item :size="btnSize" to="/settings">
                <q-item-section avatar>
                  <q-icon :name="matSettings" />
                </q-item-section>
                <q-item-section>Open settings</q-item-section>
              </q-item>
              <q-item
                v-ripple
                clickable
                href="https://github.com/xyntopia/taskyon"
                target="_blank"
                exact
              >
                <q-item-section avatar>
                  <q-icon :name="mdiGithub" />
                </q-item-section>
                <q-item-section>Visit our Taskyon repository</q-item-section>
              </q-item>
              <q-separator />
              <q-item
                v-ripple
                clickable
                to="/docs/index"
                exact
                active-class="text-secondary"
              >
                <q-item-section avatar>
                  <q-icon :name="matHelpOutline" />
                </q-item-section>
                <q-item-section> Documentation </q-item-section>
              </q-item>
              <q-item
                v-ripple
                clickable
                to="/pricing"
                exact
                active-class="text-secondary"
              >
                <q-item-section> AI chat price list </q-item-section>
              </q-item>
              <q-separator />
              <q-item>
                <q-item-section>
                  <DarkModeButton
                    v-if="state"
                    dense
                    flat
                    label="Change Theme"
                    :size="btnSize"
                    @theme-changed="(newMode) => (state!.darkTheme = newMode)"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn
          v-else
          flat
          dense
          size="xs"
          icon-right="svguse:/taskyon_mono_opt.svg#taskyon"
          no-caps
          href="https://taskyon.space"
          target="_blank"
          exact
        >
          <q-tooltip :delay="500">Powered by taskyon.space</q-tooltip>
        </q-btn>
      </component>
    </q-header>

    <q-drawer
      v-if="state"
      v-model="drawerOpen"
      show-if-above
      persistent
      :width="250"
      :breakpoint="800"
      class="print-hide"
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
import { ref, computed } from 'vue';
import DarkModeButton from 'components/DarkModeButton.vue';
import { defineAsyncComponent } from 'vue';
import type { useTaskyonStore } from 'stores/taskyonState';
import {
  matHelpOutline,
  matMenu,
  matSearch,
  matSettings,
  matToc,
  matWarning,
} from '@quasar/extras/material-icons';
import { mdiForum, mdiForumPlus, mdiGithub } from '@quasar/extras/mdi-v6';

const drawerOpen = ref(false);

const ChatSidebar = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "ChatSidebar" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'components/taskyon/ChatSidebar.vue'
    ),
);

const TableOfChatContent = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "TableOfChatContent" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'components/taskyon/TableOfChatContent.vue'
    ),
);

//const state = useTaskyonStore();
let state = ref<undefined | ReturnType<typeof useTaskyonStore>>();

void import('stores/taskyonState').then(({ useTaskyonStore }) => {
  state.value = useTaskyonStore();
});

const minMode = computed(() => {
  return state.value?.minimalGui;
});
const btnSize = computed(() => {
  return minMode.value ? 'xs' : 'md';
});
</script>
