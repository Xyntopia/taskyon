<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <div class="q-pa-md row items-center">
      <div class="text-h6 q-pr-md">Basic Settings:</div>
      <SimpleSettings />
    </div>
    <q-tabs :model-value="selectedTab" align="justify">
      <q-route-tab
        :to="{ params: { tab: 'llmproviders' } }"
        exact
        label="LLM Providers"
      />
      <q-route-tab
        :to="{ params: { tab: 'sync' } }"
        exact
        label="Sync & Backup"
      />
      <q-route-tab
        :to="{ params: { tab: 'instructions' } }"
        exact
        label="AI/LLM Instructions"
      />
      <q-route-tab
        :to="{ params: { tab: 'agent config' } }"
        exact
        label="Agent Configuration"
      />
      <q-route-tab
        v-if="state.appConfiguration.expertMode || selectedTab == 'app config'"
        :to="{ params: { tab: 'app config' } }"
        exact
        label="Expert App Configuration"
      />
    </q-tabs>
    <q-tab-panels
      :model-value="selectedTab"
      animated
      swipeable
      infinite
      :class="$q.dark.isActive ? 'bg-primary' : 'white'"
    >
      <q-tab-panel name="llmproviders">
        <LLMProviders style="max-width: 600px" />
      </q-tab-panel>
      <q-tab-panel name="sync">
        <SyncTaskyon style="max-width: 600px" />
      </q-tab-panel>
      <q-tab-panel name="instructions">
        <div>Set custom instructions for the AI Model</div>
        <ObjectTreeView :model-value="state.chatState.taskChatTemplates" />
      </q-tab-panel>
      <q-tab-panel name="agent config">
        <div>All of the Agent configuration</div>
        <ObjectTreeView :model-value="state.chatState" />
        <!--{{ state.chatState }}-->
      </q-tab-panel>
      <q-tab-panel name="app config">
        <div>All of the app configurations</div>
        <ObjectTreeView :model-value="state.appConfiguration" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from 'components/LLMProviders.vue';
import SimpleSettings from 'components/SimpleSettings.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import SyncTaskyon from 'components/SyncTaskyon.vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const state = useTaskyonStore();

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'llmproviders';
});
</script>
