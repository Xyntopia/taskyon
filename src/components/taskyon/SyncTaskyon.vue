<template>
  <q-list dense>
    <q-item-label header>
      Task Device Synchronization
      <InfoDialog
        info-text="**Taskyon** makes it easy to **synchronize your tasks securely across all your devices**.
In addition, you can choose to connect with third-party cloud storage providers—like Google Drive—for seamless access everywhere.

---

Your privacy and security are our top priority. Taskyon uses **end-to-end encryption** before any data is synchronized or stored outside the app. *(Learn more about end-to-end encryption [here](https://en.wikipedia.org/wiki/End-to-end_encryption).)*

In practice, this means that **only you** can read your data—**not** Taskyon’s developers, **not** Google, and **not** any other storage provider. Every task you create is fully encrypted before it leaves your device, and only Taskyon can decrypt it for you.

With Taskyon, your tasks are always **yours alone**.
"
      />
    </q-item-label>
    <q-item>
      <SyncAskDialog />
    </q-item>
    <template v-if="state.appConfiguration.expertMode">
      <q-expansion-item label="ID Management" expand-separator class="q-py-sm">
        <q-item>
          <q-item-section>
            Device ID: {{ deviceStr?.['Device ID'] }} <br />
            Session ID: {{ state.sessionId }}
          </q-item-section>
        </q-item>
        <q-item v-if="false">
          <q-item-label caption>
            Current Peer ID: {{ 'N/A' }}
            <InfoDialog
              info-text="Your Current Peer ID is a unique identifier for this specific device.
It helps Taskyon distinguish between different devices you use, enabling secure
synchronization and backup of your data. Peer IDs are ephemeral and shared with other
users to securily exchange information. ou do not need to keep track of it."
            />
          </q-item-label>
          <q-item-label> </q-item-label>
        </q-item>
        <q-item-label header>
          Decentralized Taskyon ID
          <InfoDialog
            info-text="Generate a decentralized, cryptographic user ID which can be used to interact with \
other taskyon users in a secure way. You can protect messages by encrypting them \
and verify the authenticity of messages sent by other users."
          />
        </q-item-label>
        <q-item class="items-center">
          <q-item-section avatar>
            <q-icon :name="mdiAccountKey" size="md" />
            User ID (beta)
          </q-item-section>
          <q-item-section side>
            <q-dialog v-model="showSeedPhrase" no-backdrop-dismiss>
              <q-card>
                <q-card-section class="text-warning">
                  This is the seed phrase for your new cryptographic user ID. This ID is only known
                  to you. Store the phrase securely and never share it with anyone. You can use it
                  to recover your ID if needed, but losing or exposing it could compromise your
                  access and security for taskyon.
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
                    @click="
                      () => {
                        console.log('copied seed phrase to clipboard...')
                        copyToClipboard(seedPhrase)
                        pressedSeedPhraseCopyButton = true
                      }
                    "
                  ></q-btn>
                </q-card-section>
                <q-card-section class="row justify-around">
                  <q-btn
                    :disable="!pressedSeedPhraseCopyButton"
                    flat
                    :color="pressedSeedPhraseCopyButton ? 'positive' : undefined"
                    label="Accept"
                    @click="
                      () => {
                        onAcceptSeedPhrase(seedPhrase)
                        showSeedPhrase = false
                      }
                    "
                    ><q-tooltip v-if="!pressedSeedPhraseCopyButton" class="bg-warning">
                      Press the copy button next to the seedphrase first in order to be able to
                      accept!
                    </q-tooltip>
                  </q-btn>
                  <q-btn flat label="Cancel" @click="showSeedPhrase = false"></q-btn>
                </q-card-section>
              </q-card>
            </q-dialog>
            <q-btn
              v-if="state.llmSettings.userId"
              class="col-auto"
              flat
              dense
              :icon="matContentCopy"
              @click="copyToClipboard(state.llmSettings.userId)"
            >
              <q-tooltip> Copy User ID to Clipboard </q-tooltip>
            </q-btn>
          </q-item-section>
          <q-item-section v-if="state.llmSettings.userId" class="ellipsis text-bold">
            {{ state.llmSettings.userId.slice(0, 5) }} ...
            {{ state.llmSettings.userId.slice(-10) }}
          </q-item-section>
          <q-item-section side>
            <div class="row">
              <q-btn
                class="col-auto"
                dense
                :label="state.llmSettings.userId ? 'Regenerate' : 'New'"
                flat
                @click="onGenerateSeedPhrase"
              >
                <q-tooltip> Generate a new User ID & Seedphrease. </q-tooltip>
              </q-btn>
              <q-btn
                v-if="state.llmSettings.userId"
                class="col-auto"
                :icon="matDeleteForever"
                dense
                flat
                @click="state.llmSettings.userId = undefined"
              >
                <q-tooltip> Delete User ID. </q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
      </q-expansion-item>
      <!--load profiles..-->
      <!--TODO: <q-item-label header> Profiles </q-item-label>
      <q-item> </q-item>
      <q-separator spaced />-->
    </template>
    <q-expansion-item label="Task Backup" expand-separator class="q-py-sm">
      <q-item class="q-mb-lg">
        <q-item-section>
          <q-btn
            :icon="matDownload"
            flat
            label="Save all Chats & Tasks"
            @click="onDownloadTaskyonData"
          >
          </q-btn>
        </q-item-section>
        <q-item-section>
          <FileDropzone disable-dropzone-border accept="*" @add-files="onUploadTaskyonData">
            <q-btn :icon="matUpload" label="Upload Tasks from file" flat />
          </FileDropzone>
        </q-item-section>
      </q-item>
      <q-item>
        <q-item-section>
          <TyResetButton
            :icon="matDeleteForever"
            label="Delete Taskyon Chat Data"
            color="red"
            outline
            mode="tasks"
          >
          </TyResetButton>
        </q-item-section>
      </q-item>
    </q-expansion-item>
    <q-expansion-item label="Taskyon Configuration Backup" expand-separator class="q-py-sm">
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
          <FileDropzone disable-dropzone-border accept="*" @add-files="loadSettingsJson">
            <q-btn outline class="fit">
              JSON
              <q-tooltip>Select Json file for upload!</q-tooltip>
            </q-btn>
          </FileDropzone>
          <FileDropzone disable-dropzone-border accept="*" @add-files="loadSettingsYaml">
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
          <TyResetButton
            :icon="matWarning"
            label="Reset Taskyon Settings"
            outline
            class="q-my-md"
            text-color="red"
            mode="settings"
          />
        </q-item-section>
      </q-item>
    </q-expansion-item>
  </q-list>
</template>

<script setup lang="ts">
import {
  matContentCopy,
  matDeleteForever,
  matDownload,
  matSave,
  matSync,
  matUpload,
  matWarning,
} from '@quasar/extras/material-icons'
import { mdiAccountKey, mdiGoogleDrive } from '@quasar/extras/mdi-v6'
import { generateSeedPhrase, keyPairFromMnemonic } from '@taskyon/taskyon'
import FileDropzone from 'components/FileDropzone.vue'
import yaml from 'js-yaml'
import { copyToClipboard, exportFile, extend } from 'quasar'
import { useGdrive } from 'src/modules/gdrive'
import { TyProfile } from 'src/modules/taskyon/types'
import { deepMergeReactive } from 'src/modules/utils'
import { asyncComputed } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { ref } from 'vue'
import InfoDialog from '../InfoDialog.vue'
import SyncAskDialog from './SyncAskDialog.vue'
import TyResetButton from './TyResetButton.vue'

const tystate = useTaskyonStore()
const state = useAppStateStore()
const { saveObjToGdrive, loadObjFromGdrive } = useGdrive(tystate.getGdriveToken)

const showSeedPhrase = ref(false)
const pressedSeedPhraseCopyButton = ref(false)
const seedPhrase = ref('')

const deviceStr = asyncComputed(
  async () => ({ 'Device ID': await tystate.getDeviceId() }),
  undefined,
)

function onGenerateSeedPhrase() {
  console.log('generate user id...')
  pressedSeedPhraseCopyButton.value = false
  showSeedPhrase.value = true
  const mnemonic = generateSeedPhrase()
  seedPhrase.value = mnemonic
}

async function onAcceptSeedPhrase(seedPhrase: string) {
  const key = await keyPairFromMnemonic(seedPhrase)
  state.llmSettings.userId = key.pkb64
  throw new Error("doesn't work yet!")
}

async function onUpdateAppConfiguration() {
  const loadedConfig = await loadObjFromGdrive(
    state.appConfiguration.gdriveDir,
    state.appConfiguration.gdriveConfigurationFile,
  )
  if (loadedConfig) {
    deepMergeReactive(
      state.appConfiguration,
      (loadedConfig.appConfiguration || {}) as Record<string, unknown>,
    )
    deepMergeReactive(
      state.llmSettings,
      (loadedConfig.llmSettings || {}) as Record<string, unknown>,
    )
  }
}

async function onSyncGdrive() {
  await saveObjToGdrive(
    {
      llmSettings: state.llmSettings,
      appConfiguration: state.appConfiguration,
    },
    state.appConfiguration.gdriveDir,
    state.appConfiguration.gdriveConfigurationFile,
  )
}

// Function to load JSON settings
// Common function to handle file reading and state updating
async function loadSettingsFromFile(newFiles: File[], parseFunction: (content: string) => unknown) {
  if (newFiles.length === 0) return // No file uploaded

  const file = newFiles[0]! // Assuming only one file is uploaded

  // TODO: merge this function with the one we're using in tyState and make sure we do version
  //       checks...
  try {
    const fileContent = await file.text()
    const loadedData = parseFunction(fileContent) as Record<string, unknown>
    const loadedProfile = TyProfile.partial().parse(loadedData)

    if (loadedProfile?.llmSettings) {
      deepMergeReactive(state.llmSettings, loadedProfile.llmSettings)
    }
    if (loadedProfile?.appConfiguration) {
      deepMergeReactive(state.appConfiguration, loadedProfile.appConfiguration)
    }
  } catch (error) {
    console.error('Error processing file', error)
  }
  console.log('new configuration loaded:', state)
}

// Function to load JSON settings
function loadSettingsJson(newFiles: File[]) {
  void loadSettingsFromFile(newFiles, JSON.parse)
}

// Function to load YAML settings
function loadSettingsYaml(newFiles: File[]) {
  void loadSettingsFromFile(newFiles, yaml.load)
}

const downloadSettings = (format: string) => {
  console.log('download settings')
  //relevant settings:
  const { llmSettings, appConfiguration, version } = state
  // Convert reactive llmSettingsProperties to a raw object
  const deepCopiedSettings = extend(true, {}, { version, appConfiguration, llmSettings })

  let fileName, fileContent, mimeType

  if (format === 'json') {
    fileName = 'taskyon_settings.json'
    fileContent = JSON.stringify(deepCopiedSettings, null, 2)
    mimeType = 'application/json'
  } else {
    fileName = 'taskyon_settings.yaml'
    fileContent = yaml.dump(deepCopiedSettings)
    mimeType = 'text/yaml'
  }

  // Use Quasar's exportFile function for download
  exportFile(fileName, fileContent, mimeType)
}

async function onDownloadTaskyonData() {
  const ty = await tystate.taskyon
  const jsonBackup = await ty.getJsonTaskBackup()
  console.log('downloading tasks in json format')
  const timestamp = new Date().toISOString()
  exportFile(`${timestamp}_taskyon_data.json`, jsonBackup, 'application/json')
}

async function onUploadTaskyonData(newFiles: File[]) {
  if (newFiles.length === 0) return // No file uploaded

  const file = newFiles[0]! // Assuming only one file is uploaded

  try {
    const fileContent = await file.text()
    const ty = await tystate.taskyon
    await ty.addTaskBackup(fileContent)
    location.reload() // reload browser window to update app state...
  } catch (error) {
    console.error('Error processing file', error)
  }
}
</script>
