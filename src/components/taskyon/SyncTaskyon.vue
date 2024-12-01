<template>
  <q-list dense>
    <q-item-label v-if="state.appConfiguration.expertMode" header
      >User ID Management</q-item-label
    >
    <q-item v-if="state.appConfiguration.expertMode" class="items-center">
      <q-item-section avatar>
        <q-icon :name="mdiAccountKey" size="md" />
        User ID
      </q-item-section>
      <q-item-section side>
        <q-dialog v-model="showSeedPhrase" auto-close>
          <q-card>
            <q-card-section>
              This is the seed phrase for your cryptographic user ID. Store it
              securely and never share it with anyone. You can use it to recover
              your ID if needed, but losing or exposing it could compromise your
              access and security.
            </q-card-section>
            <q-card-section class="row">
              <div class="rounded-borders text-bold col text-info">
                {{ seedPhrase }}
              </div>
              <q-btn
                class="col-auto"
                flat
                dense
                :icon="matContentCopy"
                @click="copyToClipboard(seedPhrase)"
              ></q-btn>
            </q-card-section>
            <q-card-section>
              <q-btn
                flat
                label="Accept"
                @click="onAcceptSeedPhrase(seedPhrase)"
              ></q-btn>
            </q-card-section>
          </q-card>
        </q-dialog>
        <q-btn
          class="col-auto"
          v-if="state.llmSettings.userId"
          flat
          dense
          :icon="matContentCopy"
          @click="copyToClipboard(state.llmSettings.userId)"
        ></q-btn>
      </q-item-section>
      <q-item-section
        v-if="state.llmSettings.userId"
        class="ellipsis text-bold"
      >
        {{ state.llmSettings.userId.slice(0, 5) }} ...
        {{ state.llmSettings.userId.slice(-10) }}
      </q-item-section>
      <q-item-section side>
        <div class="row">
          <q-btn
            class="col-auto"
            v-if="!state.llmSettings.userId"
            label="Generate"
            outline
            @click="onGenerateSeedPhrase"
          ></q-btn>
          <q-btn
            class="col-auto"
            dense
            label="New"
            flat
            @click="onGenerateSeedPhrase"
          ></q-btn>
          <q-btn
            class="col-auto"
            :icon="matDeleteForever"
            dense
            flat
            @click="state.llmSettings.userId = undefined"
          ></q-btn>
        </div>
      </q-item-section>
      <q-item-section side>
        <InfoDialog
          info-text="Generate a decentralized, cryptographic user ID which can be used to interact with \
 other taskyon users in a secure way. When loading taskyon for the first time, this ID is automatically generated!"
      /></q-item-section>
    </q-item>
    <q-separator v-if="state.appConfiguration.expertMode" spaced />
    <q-item-label header>Task Backup and Synchronization</q-item-label>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section>
        <q-btn
          :icon="matDownload"
          color="secondary"
          unelevated
          label="Save all Chats & Tasks"
          @click="onDownloadTaskyonData"
        >
        </q-btn>
      </q-item-section>
      <q-item-section>
        <FileDropzone
          disable-dropzone-border
          accept="*"
          @update:model-value="onUploadTaskyonData"
        >
          <q-btn
            :icon="matUpload"
            label="Upload Tasks from file"
            color="secondary"
            unelevated
          />
        </FileDropzone>
      </q-item-section>
      <q-item-section>
        <q-btn
          :icon="matDeleteForever"
          label="Delete Taskyon Chat Data"
          color="red"
          outline
          @click="showDeleteDialog = true"
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
              <q-btn v-close-popup flat label="Cancel" />
              <q-btn
                v-close-popup
                flat
                label="Delete"
                color="negative"
                :icon="matDeleteForever"
                @click="onDeleteTaskyonData"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>
      </q-item-section>
    </q-item>
    <q-item-label header>Taskyon Configuration Backup</q-item-label>
    <q-item>
      <q-item-section avatar>
        <q-icon :name="matSave" size="md" />
      </q-item-section>
      <q-item-section>Download Settings:</q-item-section>
      <div class="row q-gutter-xs">
        <q-btn label="JSON" outline @click="downloadSettings('json')"></q-btn>
        <q-btn label="YAML" outline @click="downloadSettings('yaml')"></q-btn>
      </div>
    </q-item>
    <q-item>
      <q-item-section avatar>
        <q-icon :name="matUpload" size="md" />
      </q-item-section>
      <q-item-section>Upload Settings:</q-item-section>
      <div class="row q-gutter-xs">
        <FileDropzone
          disable-dropzone-border
          accept="*"
          @update:model-value="loadSettingsJson"
        >
          <q-btn outline class="fit">
            JSON
            <q-tooltip>Select Json file for upload!</q-tooltip>
          </q-btn>
        </FileDropzone>
        <FileDropzone
          disable-dropzone-border
          accept="*"
          @update:model-value="loadSettingsYaml"
        >
          <q-btn outline class="fit">
            YAML
            <q-tooltip>Select YAML file for upload!</q-tooltip>
          </q-btn>
        </FileDropzone>
      </div>
    </q-item>
    <q-item class="q-pa-md q-gutter-sm">
      <q-item-section avatar>
        <q-icon size="md" :name="mdiGoogleDrive" />
      </q-item-section>

      <q-item-section> Export app & settings to gdrive: </q-item-section>
      <div class="row q-gutter-xs">
        <q-btn :icon="matSave" outline @click="onSyncGdrive">
          <q-tooltip> Save configuration to gdrive</q-tooltip>
        </q-btn>
        <q-btn :icon="matSync" outline @click="onUpdateAppConfiguration">
          <q-tooltip> Restore app configuration from gdrive</q-tooltip>
        </q-btn>
      </div>
    </q-item>
    <q-item>
      <q-item-section>
        <q-btn
          :icon="matWarning"
          label="Reset Taskyon Settings"
          outline
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
              settings. It will *not* delete any of your chats.
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
            <q-btn v-close-popup flat label="Cancel" />
            <q-btn
              v-close-popup
              flat
              label="Reset"
              color="negative"
              :icon="matDeleteForever"
              @click="onResetTaskyon"
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
import { copyToClipboard, exportFile, extend } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import yaml from 'js-yaml';
import { useGdrive } from 'src/modules/gdrive';
import { deepMergeReactive } from 'src/modules/utils';
import {
  matSync,
  matSave,
  matDownload,
  matDeleteForever,
  matUpload,
  matWarning,
  matContentCopy,
} from '@quasar/extras/material-icons';
import { mdiAccountKey, mdiGoogleDrive } from '@quasar/extras/mdi-v6';
import InfoDialog from '../InfoDialog.vue';
import { base64UrlEd25519Keys, generateRandomNewKey } from 'src/modules/crypto';

const state = useTaskyonStore();
const { saveObjToGdrive, loadObjFromGdrive } = useGdrive();

const showSeedPhrase = ref(false);
const seedPhrase = ref('');

async function onGenerateSeedPhrase() {
  console.log('generate user id...');
  showSeedPhrase.value = true;
  const { mnemonic } = await generateRandomNewKey();
  seedPhrase.value = mnemonic;
}

async function onAcceptSeedPhrase(seedPhrase: string) {
  const { /*privateKey,*/ publicKey } = await base64UrlEd25519Keys(seedPhrase);
  state.llmSettings.userId = publicKey;
}

async function onUpdateAppConfiguration() {
  const loadedConfig = await loadObjFromGdrive(
    state.appConfiguration.gdriveDir,
    state.appConfiguration.gdriveConfigurationFile,
  );
  if (loadedConfig) {
    deepMergeReactive(
      state.appConfiguration,
      (loadedConfig.appConfiguration || {}) as Record<string, unknown>,
      'overwrite',
    );
    deepMergeReactive(
      state.llmSettings,
      (loadedConfig.llmSettings || {}) as Record<string, unknown>,
      'overwrite',
    );
  }
}

async function onSyncGdrive() {
  saveObjToGdrive(
    {
      llmSettings: state.llmSettings,
      appConfiguration: state.appConfiguration,
    },
    state.appConfiguration.gdriveDir,
    state.appConfiguration.gdriveConfigurationFile,
  );
}

// Function to load JSON settings
// Common function to handle file reading and state updating
async function loadSettingsFromFile(
  newFiles: File[],
  parseFunction: (content: string) => unknown,
) {
  if (newFiles.length === 0) return; // No file uploaded

  const file = newFiles[0]!; // Assuming only one file is uploaded

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
        'overwrite',
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
    { version, appConfiguration, llmSettings },
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

  const file = newFiles[0]!; // Assuming only one file is uploaded

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
  state.chatHistory = [];
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload(); // reload browser window to reinitialize the db...
}

function onResetTaskyon() {
  console.log('reset taskyon!');
  state.$reset();
  //location.reload(); // reload browser window to reinitialize the db...
}
</script>
