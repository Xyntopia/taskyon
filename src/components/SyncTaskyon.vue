<template>
  <q-list dense>
    <q-item-label header>Task Backup and Synchronization</q-item-label>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section>
        <q-btn
          @click="onDownloadTaskyonData"
          icon="download"
          label="Save all Chats & Tasks"
        >
        </q-btn>
      </q-item-section>
      <q-item-section>
        <FileDropzone
          disable-dropzone-border
          @update:model-value="onUploadTaskyonData"
          accept="*"
        >
          <q-btn icon="upload" label="Upload Tasks from file"> </q-btn>
        </FileDropzone>
      </q-item-section>
      <q-item-section>
        <q-btn
          @click="onDeleteTaskyonData"
          icon="delete_forever"
          label="Delete Taskyon Chat Data"
          text-color="red"
        >
        </q-btn>
      </q-item-section>
    </q-item>
    <q-separator spaced />
    <q-item-label header>Taskyon Configuration Backup</q-item-label>
    <q-item>
      <q-item-section avatar> <q-icon name="save" size="md" /> </q-item-section>
      <q-item-section>Download Settings:</q-item-section>
      <q-item-section>
        <q-btn label="JSON" @click="downloadSettings('json')"></q-btn>
        <q-btn label="YAML" @click="downloadSettings('yaml')"></q-btn>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section avatar>
        <q-icon name="settings_backup_restore" size="md" />
      </q-item-section>
      <q-item-section>Load Settings:</q-item-section>
      <q-item-section>
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
      </q-item-section>
    </q-item>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section avatar>
        <q-icon size="md" name="mdi-google-drive" />
      </q-item-section>

      <q-item-section> Export app & settings to gdrive: </q-item-section>
      <q-item-section>
        <q-btn @click="onSyncGdrive" icon="save">
          <q-tooltip> Save configuration to gdrive</q-tooltip>
        </q-btn>
        <q-btn @click="onUpdateAppConfiguration" icon="sync">
          <q-tooltip> Restore app configuration from gdrive</q-tooltip>
        </q-btn>
      </q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import FileDropzone from 'components/FileDropzone.vue';
import { exportFile, extend } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import yaml from 'js-yaml';
import { onSyncGdrive, onUpdateAppConfiguration } from 'src/modules/gdrive';
import { deepMergeReactive } from 'src/modules/taskyon/utils';

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
  console.log('new configuration loaded:', state);
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

async function onDownloadTaskyonData() {
  const tm = await state.getTaskManager();
  const jsonBackup = await tm.getJsonTaskBackup();
  const fileContent = JSON.stringify(jsonBackup);
  console.log('downloading tasks in json format');
  exportFile('taskyon_data.json', fileContent, 'application/json');
}

async function onUploadTaskyonData(newFiles: File[]) {
  if (newFiles.length === 0) return; // No file uploaded

  const file = newFiles[0]; // Assuming only one file is uploaded

  try {
    const fileContent = await file.text();
    const tm = await state.getTaskManager();
    await tm.addTaskBackup(fileContent);
    location.reload(); // reload browser window to update app state...
  } catch (error) {
    console.error('Error processing file', error);
  }
}

async function onDeleteTaskyonData() {
  const tm = await state.getTaskManager();
  await tm.deleteAllTasks();
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload(); // reload browser window to reinitialize the db...
}
</script>
