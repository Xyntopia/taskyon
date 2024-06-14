<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <q-toolbar :class="$q.dark.isActive ? 'bg-primary' : 'white'">
      <q-tabs class="col-auto" dense v-model="selectedTab" no-caps>
        <q-route-tab
          to="/settings/llmproviders"
          label="LLM Providers"
          name="llmproviders"
        />
        <q-route-tab to="/settings/sync" label="Reset & Backup" name="sync" />
        <q-route-tab
          to="/settings/instructions"
          label="AI/LLM Instructions"
          name="instructions"
        />
        <q-route-tab
          to="/settings/agent config"
          label="Agent Configuration"
          name="agent config"
        />
        <q-route-tab
          v-if="
            state.appConfiguration.expertMode || selectedTab == 'app config'
          "
          to="/settings/app config"
          label="Expert App Configuration"
          name="app config"
        />
      </q-tabs>
    </q-toolbar>
    <div class="fit text-center"><ExpertEnable /></div>
    <div>
      <q-tab-panels
        :model-value="selectedTab"
        animated
        swipeable
        infinite
        :class="[$q.dark.isActive ? 'bg-primary' : 'white']"
      >
        <q-tab-panel name="llmproviders" :class="tabPanelClass">
          <LLMProviders
            style="max-width: 600px"
            v-model:expertModeOn="state.appConfiguration.expertMode"
          />
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
    </div>
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
