<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <div class="q-pa-md row items-center q-gutter-sm">
      <div class="col-auto">Download Settings:</div>
      <q-icon name="save" size="md" />
      <q-btn label="JSON" @click="downloadSettings('json')"></q-btn>
      <q-btn label="YAML" @click="downloadSettings('yaml')"></q-btn>
      <div>Load Settings:</div>
      <q-icon name="upload_file" size="md" />
      <FileDropzone
        disable-dropzone-border
        @update:model-value="loadSettingsJson"
        accept="*"
      >
        <q-btn>
          JSON
          <q-tooltip>Select Json file for upload!</q-tooltip>
        </q-btn>
      </FileDropzone>
      <FileDropzone
        disable-dropzone-border
        @update:model-value="loadSettingsYaml"
        accept="*"
      >
        <q-btn>
          YAML
          <q-tooltip>Select YAML file for upload!</q-tooltip>
        </q-btn>
      </FileDropzone>
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
      <q-tab v-if="state.appConfiguration.expertMode" name="app config" label="Expert App Configuration" />
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
import FileDropzone from 'components/FileDropzone.vue';
import { deepMergeReactive } from 'src/modules/taskyon/utils';

const tab = ref('settings'); // Default to the first tab
const state = useTaskyonStore();

// Function to load JSON settings
// Common function to handle file reading and state updating
async function loadSettingsFromFile(
  newFiles: File[],
  parseFunction: (content: string) => unknown
) {
  if (newFiles.length === 0) return; // No file uploaded

  const file = newFiles[0]; // Assuming only one file is uploaded

  try {
    const fileContent = await file.text();
    const loadedData = parseFunction(fileContent) as Record<string, unknown>;

    if (loadedData?.chatState) {
      deepMergeReactive(state.chatState, loadedData.chatState);
    }
    if (loadedData?.appConfiguration) {
      deepMergeReactive(state.appConfiguration, loadedData.appConfiguration);
    }
  } catch (error) {
    console.error('Error processing file', error);
  }
  console.log('new configuration loaded:', state)
}

// Function to load JSON settings
function loadSettingsJson(newFiles: File[]) {
  void loadSettingsFromFile(newFiles, JSON.parse);
}

// Function to load YAML settings
function loadSettingsYaml(newFiles: File[]) {
  void loadSettingsFromFile(newFiles, yaml.load);
}

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
