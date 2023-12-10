<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <div class="q-pa-md">
      Download Settings:
      <q-icon name="save" size="md" />
      <q-btn
        label="JSON"
        @click="downloadSettings('json')"
        color="primary"
        class="q-ma-md"
      ></q-btn>
      <q-btn
        label="YAML"
        @click="downloadSettings('yaml')"
        color="primary"
        class="q-ma-md"
      ></q-btn>
    </div>
    <div>
      Export app & settings to gdrive:
      <GoogleLogin
        clientId="14927198496-1flnp4qo0e91phctnjsfrci5ce0rp91s.apps.googleusercontent.com"
        :callback="callback"
        popup-type="TOKEN"
      >
        <q-btn>Login Using Google</q-btn>
      </GoogleLogin>
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
import { GoogleLogin } from 'vue3-google-login';
import type { CallbackTypes } from 'vue3-google-login';

const callback: CallbackTypes.TokenResponseCallback = (response) => {
  console.log('Access token', response.access_token);
};

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
