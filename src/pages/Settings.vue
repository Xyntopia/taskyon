<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
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
    <div class="fit text-center">
      <ExpertEnable/>
    </div>
    <q-tab-panels
      :model-value="selectedTab"
      animated
      swipeable
      infinite
      :class="[$q.dark.isActive ? 'bg-primary' : 'white']"
    >
      <q-tab-panel name="llmproviders" :class="tabPanelClass">
        <LLMProviders style="max-width: 600px" />
      </q-tab-panel>
      <q-tab-panel name="sync" :class="tabPanelClass">
        <SyncTaskyon style="max-width: 600px" />
      </q-tab-panel>
      <q-tab-panel name="instructions" :class="tabPanelClass">
        <div>Set custom instructions for the AI Model</div>
        <ObjectTreeView
          :model-value="state.llmSettings.taskChatTemplates"
          class="fit"
        />
      </q-tab-panel>
      <q-tab-panel name="agent config" :class="tabPanelClass">
        <div>All of the Agent configuration</div>
        <ObjectTreeView :model-value="state.llmSettings" class="fit" />
        <!--{{ state.llmSettings }}-->
      </q-tab-panel>
      <q-tab-panel name="app config" :class="tabPanelClass">
        <div>All of the app configurations</div>
        <ObjectTreeView :model-value="state.appConfiguration" class="fit" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from 'components/LLMProviders.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import SyncTaskyon from 'components/SyncTaskyon.vue';
import { useRoute } from 'vue-router';
import ExpertEnable from './ExpertEnable.vue';

const route = useRoute();
const state = useTaskyonStore();

const tabPanelClass = 'column items-center';

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'llmproviders';
});
</script>
