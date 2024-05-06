<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <div class="q-pa-md row items-center">
      <div class="text-h6 q-pr-md">Basic Settings:</div>
      <SimpleSettings />
    </div>
    <q-tabs v-model="state.guiState.settingsTab" align="justify">
      <q-tab name="llmproviders" label="LLM Providers" />
      <q-tab name="sync" label="Sync & Backup" />
      <q-tab name="instructions" label="AI/LLM Instructions" />
      <q-tab name="agent config" label="Agent Configuration" />
      <q-tab
        v-if="state.appConfiguration.expertMode"
        name="app config"
        label="Expert App Configuration"
      />
    </q-tabs>
    <q-tab-panels
      v-model="state.guiState.settingsTab"
      animated
      :class="$q.dark.isActive ? 'bg-primary' : 'white'"
    >
      <q-tab-panel name="llmproviders">
        <LLMProviders></LLMProviders>
      </q-tab-panel>
      <q-tab-panel name="sync">
        <SyncTaskyon style="max-width: 600px;"/>
      </q-tab-panel>
      <q-tab-panel name="instructions">
        <div>Set custom instructions for the AI Model</div>
        <ObjectTreeView :model-value="state.chatState.taskChatTemplates" />
      </q-tab-panel>
      <q-tab-panel name="agent config">
        <div>ALl of the Agent configuration</div>
        <ObjectTreeView :model-value="state.chatState" />
      </q-tab-panel>
      <q-tab-panel name="app config">
        <div>All of the app configurations</div>
        <ObjectTreeView :model-value="state.appConfiguration" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import LLMProviders from 'components/LLMProviders.vue';
import SimpleSettings from 'components/SimpleSettings.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import SyncTaskyon from 'components/SyncTaskyon.vue';

const state = useTaskyonStore();
</script>
