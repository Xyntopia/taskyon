<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <div class="q-pa-md">
      Download Settings:
      <q-icon name="save" size="md" />
      <q-btn
        label="JSON"
        @click="downloadSettings('json')"
        class="q-ma-md"
      ></q-btn>
      <q-btn
        label="YAML"
        @click="downloadSettings('yaml')"
        class="q-ma-md"
      ></q-btn>
    </div>
    <div class="q-pa-md q-gutter-sm">
      Export app & settings to gdrive:
      <q-icon size="md" name="mdi-google-drive" />
      <q-btn @click="onSyncGdrive" icon="save">
        <q-tooltip> Save configuration to gdrive</q-tooltip>
      </q-btn>
      <q-btn @click="onUpdateAppConfiguration" icon="sync">
        <q-tooltip> Restore app configuration from gdrive</q-tooltip>
      </q-btn>
    </div>
    <q-tabs v-model="tab" align="justify">
      <q-tab name="settings" label="Settings" />
      <q-tab name="instructions" label="Instructions" />
      <q-tab name="agent config" label="Agent Configuration" />
      <q-tab name="app config" label="App Configuration" />
    </q-tabs>
    <q-tab-panels
      v-model="tab"
      animated
      :class="$q.dark.isActive ? 'bg-primary' : 'white'"
    >
      <q-tab-panel name="settings">
        <Settings></Settings>
      </q-tab-panel>
      <q-tab-panel name="instructions">
        <ObjectTreeView :model-value="state.chatState.taskChatTemplates" />
      </q-tab-panel>
      <q-tab-panel name="agent config">
        <ObjectTreeView :model-value="state.chatState" />
      </q-tab-panel>
      <q-tab-panel name="app config">
        <ObjectTreeView :model-value="state.appConfiguration" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { exportFile, extend } from 'quasar';
import { ref } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import Settings from 'components/Settings.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import yaml from 'js-yaml';
import { onSyncGdrive, onUpdateAppConfiguration } from 'src/modules/gdrive';
import OpenRouterPKCE from './OpenRouterPKCE.vue';

const tab = ref('settings'); // Default to the first tab
const state = useTaskyonStore();

const downloadSettings = (format: string) => {
  console.log('download settings');
  //relevant settings:
  const { chatState, appConfiguration } = state;
  // Convert reactive chatStateProperties to a raw object
  const deepCopiedSettings = extend(true, {}, { appConfiguration, chatState });

  let fileName, fileContent, mimeType;

  if (format === 'json') {
    fileName = 'taskyon_settings.json';
    fileContent = JSON.stringify(deepCopiedSettings, null, 2);
    mimeType = 'application/json';
  } else {
    fileName = 'taskyon_settings.yaml';
    fileContent = yaml.dump(deepCopiedSettings);
    mimeType = 'text/yaml';
  }

  // Use Quasar's exportFile function for download
  exportFile(fileName, fileContent, mimeType);
};
</script>
