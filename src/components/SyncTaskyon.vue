<template>
  <q-list dense>
    <q-item-label header>Task Backup and Synchronization</q-item-label>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section>
        <q-btn
          @click="onDownloadTaskyonData"
          :icon="matDownload"
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
          <q-btn :icon="matUpload" label="Upload Tasks from file"> </q-btn>
        </FileDropzone>
      </q-item-section>
      <q-item-section>
        <q-btn
          @click="showDeleteDialog = true"
          :icon="matDeleteForever"
          label="Delete Taskyon Chat Data"
          text-color="red"
        >
        </q-btn>
        <q-dialog v-model="showDeleteDialog">
          <q-card>
            <q-card-section>
              <div class="text-h6 text-red text-center">
                <q-icon :name="matWarning" size="md" />
                Warning: Delete Taskyon Chat Data
              </div>
            </q-card-section>
            <q-card-section class="q-pt-none">
              <p>
                <strong>Warning:</strong> This operation will permanently delete
                all Taskyon chat data. This action cannot be undone.
              </p>
              <p>
                Before proceeding, please make sure you have a backup of your
                data. You can download your data in JSON or YAML format using
                the buttons above.
              </p>
              <!--<p>
          If you're sure you want to delete all Taskyon chat data, enter "DELETE" in the field below to confirm:
        </p>
        <q-input v-model="deleteConfirmation" label="Confirmation" />-->
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat label="Cancel" v-close-popup />
              <q-btn
                flat
                label="Delete"
                color="negative"
                :icon="matDeleteForever"
                @click="onDeleteTaskyonData"
                v-close-popup
              />
            </q-card-actions>
          </q-card>
        </q-dialog>
      </q-item-section>
    </q-item>
    <q-separator spaced />
    <q-item-label header>Taskyon Configuration Backup</q-item-label>
    <q-item>
      <q-item-section avatar>
        <q-icon :name="matSave" size="md" />
      </q-item-section>
      <q-item-section>Download Settings:</q-item-section>
      <q-item-section>
        <q-btn label="JSON" @click="downloadSettings('json')"></q-btn>
        <q-btn label="YAML" @click="downloadSettings('yaml')"></q-btn>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section avatar>
        <q-icon :name="matSettingsBackupRestore" size="md" />
      </q-item-section>
      <q-item-section>Upload Settings:</q-item-section>
      <q-item-section>
        <FileDropzone
          disable-dropzone-border
          @update:model-value="loadSettingsJson"
          accept="*"
        >
          <q-btn class="fit">
            JSON
            <q-tooltip>Select Json file for upload!</q-tooltip>
          </q-btn>
        </FileDropzone>
        <FileDropzone
          disable-dropzone-border
          @update:model-value="loadSettingsYaml"
          accept="*"
        >
          <q-btn class="fit">
            YAML
            <q-tooltip>Select YAML file for upload!</q-tooltip>
          </q-btn>
        </FileDropzone>
      </q-item-section>
    </q-item>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section avatar>
        <q-icon size="md" :name="mdiGoogleDrive" />
      </q-item-section>

      <q-item-section> Export app & settings to gdrive: </q-item-section>
      <q-item-section>
        <q-btn @click="onSyncGdrive" :icon="matSave">
          <q-tooltip> Save configuration to gdrive</q-tooltip>
        </q-btn>
        <q-btn @click="onUpdateAppConfiguration" :icon="matSync">
          <q-tooltip> Restore app configuration from gdrive</q-tooltip>
        </q-btn>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section>
        <q-btn
          :icon="matWarning"
          label="Reset Taskyon Settings"
          class="q-ma-md"
          text-color="red"
          @click="showResetDialog = true"
        />
      </q-item-section>
      <q-dialog v-model="showResetDialog">
        <q-card>
          <q-card-section>
            <div class="text-h6 text-red text-center">
              <q-icon :name="matWarning" size="md" />
              Warning: Reset all Taskyon Settings
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <p>
              <strong>Warning:</strong> This operation will reset all taskyon
              settings.
            </p>
            <p>
              Before proceeding, please make sure you have a backup of the
              settings. You can download your data in JSON or YAML format using
              the buttons above.
            </p>
            <!--<p>
          If you're sure you want to delete all Taskyon chat data, enter "DELETE" in the field below to confirm:
        </p>
        <q-input v-model="deleteConfirmation" label="Confirmation" />-->
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" v-close-popup />
            <q-btn
              flat
              label="Reset"
              color="negative"
              :icon="matDeleteForever"
              @click="onResetTaskyon"
              v-close-popup
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import FileDropzone from 'components/FileDropzone.vue';
import { exportFile, extend } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import yaml from 'js-yaml';
import { onSyncGdrive, onUpdateAppConfiguration } from 'src/modules/gdrive';
import { deepMergeReactive } from 'src/modules/taskyon/utils';
import {
  matSync,
  matSave,
  matDownload,
  matDeleteForever,
  matUpload,
  matWarning,
  matSettingsBackupRestore,
} from '@quasar/extras/material-icons';
import { mdiGoogleDrive } from '@quasar/extras/mdi-v6';

const state = useTaskyonStore();

// Function to load JSON settings
// Common function to handle file reading and state updating
async function loadSettingsFromFile(
  newFiles: File[],
  parseFunction: (content: string) => unknown
) {
  if (newFiles.length === 0) return; // No file uploaded

  const file = newFiles[0]; // Assuming only one file is uploaded

  // TODO: merge this function with the one we're using in tyState and make sure we do version
  //       checks...
  try {
    const fileContent = await file.text();
    const loadedData = parseFunction(fileContent) as Record<string, unknown>;

    if (loadedData?.llmSettings) {
      deepMergeReactive(state.llmSettings, loadedData.llmSettings, 'overwrite');
    }
    if (loadedData?.appConfiguration) {
      deepMergeReactive(
        state.appConfiguration,
        loadedData.appConfiguration,
        'overwrite'
      );
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
  const { llmSettings, appConfiguration, version } = state;
  // Convert reactive llmSettingsProperties to a raw object
  const deepCopiedSettings = extend(
    true,
    {},
    { version, appConfiguration, llmSettings }
  );

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
  const timestamp = new Date().toISOString();
  exportFile(`${timestamp}_taskyon_data.json`, fileContent, 'application/json');
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

const showDeleteDialog = ref(false);
const showResetDialog = ref(false);

async function onDeleteTaskyonData() {
  const tm = await state.getTaskManager();
  await tm.deleteAllTasks();
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload(); // reload browser window to reinitialize the db...
}

function onResetTaskyon() {
  console.log('reset taskyon!')
  state.$reset()
  //location.reload(); // reload browser window to reinitialize the db...
}
</script>
