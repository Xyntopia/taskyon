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
    <q-tabs v-model="tab" align="justify">
      <q-tab name="settings" label="Settings" />
      <q-tab name="instructions" label="Instructions" />
      <q-tab name="configuration" label="Agent Configuration" />
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
        <ObjectTreeView v-model="chatStateProperties.taskChatTemplates.value" />
      </q-tab-panel>
      <q-tab-panel name="configuration">
        <ObjectTreeView v-model="chatStateProperties" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { exportFile, extend } from 'quasar';
import { toRefs, ref, toRaw } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import Settings from 'components/Settings.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import yaml from 'js-yaml';

const tab = ref('settings'); // Default to the first tab
const state = useTaskyonStore();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { chatState, ...allSettings } = state;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chatStateProperties = toRefs(state.chatState);

const downloadSettings = (format: string) => {
  console.log('download settings');
  // Convert reactive chatStateProperties to a raw object
  const deepCopiedSettings = extend(true, {}, state.chatState);

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
