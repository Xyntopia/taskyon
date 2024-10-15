<template>
  <q-page>
    <q-toolbar>
      <q-tabs v-model="selectedTab" class="col-auto" dense no-caps>
        <q-route-tab
          to="/settings/aiserviceprovider"
          label="AI Service Provider"
          name="aiserviceprovider"
        />
        <q-route-tab to="/settings/sync" label="Reset & Backup" name="sync" />
        <q-route-tab
          to="/settings/instructions"
          label="AI/LLM Instructions"
          name="instructions"
        />
        <q-route-tab
          v-if="
            state.appConfiguration.expertMode || selectedTab == 'agent config'
          "
          to="/settings/agent config"
          label="AI Configuration"
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
    <q-card class="q-ma-xs">
      <q-tab-panels :model-value="selectedTab" animated swipeable infinite>
        <q-tab-panel name="aiserviceprovider" :class="tabPanelClass">
          <LLMProviders
            v-model:expert-mode-on="state.appConfiguration.expertMode"
            style="max-width: 600px"
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
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from 'components/taskyon/LLMProviders.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import SyncTaskyon from 'components/taskyon/SyncTaskyon.vue';
import { useRoute } from 'vue-router';
import ExpertEnable from 'components/taskyon/ExpertEnable.vue';

const route = useRoute();
const state = useTaskyonStore();

const tabPanelClass = 'column items-center';

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'aiserviceprovider';
});
</script>
