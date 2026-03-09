<template>
  <q-card-section v-if="title" class="row items-center q-pb-none">
    <div class="text-h6">{{ title }}</div>
    <q-space />
    <q-btn v-close-popup icon="close" flat round dense />
  </q-card-section>
  <q-list dense class="col">
    <q-item class="text-center text-warning">
      <q-item-section side class="text-warning">Gdrive Sync is experimental!</q-item-section>
    </q-item>
    <q-item>
      <q-item-section> Current Session ID: </q-item-section>
      <q-item-section>
        <div class="text-weight-bolder text-h6">{{ state.sessionId?.slice(0, 5) }}</div>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section avatar>
        <div class="no-wrap">
          <q-icon size="md" :name="mdiGoogleDrive" />
          <q-icon size="md" :name="matSync" />
        </div>
      </q-item-section>
      <q-item-section>
        <div class="row no-wrap items-center">
          <div>Connect Google Drive for automatic sync</div>
          <InfoDialog>
            Enable Google Drive sync to automatically synchronize your tasks across all your
            devices. All tasks are fully encrypted before leaving your device — only you can read
            them.
          </InfoDialog>
        </div>
      </q-item-section>
      <q-item-section side>
        <div class="column items-center">
          <q-toggle v-model="state.appConfiguration.enableGdriveSync" color="secondary" />
          <div
            :class="
              gdp?.gdriveConnected.value != !!state.appConfiguration.enableGdriveSync
                ? 'text-negative'
                : 'text-positive'
            "
          >
            state: {{ gdp?.gdriveConnected.value ? 'connected' : 'disconnected' }}
          </div>
        </div>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section class="q-gutter-md">
        <q-btn
          :icon="matDevices"
          label="Connect a new Device to taskyon"
          flat
          :loading="uploadingSK"
          @click="uploadSK"
        >
          <q-dialog v-model="showProvisioningDialog">
            <q-card>
              <q-card-section>
                <div
                  v-if="generatedSharingLink"
                  class="row q-gutter-md items-center justify-center"
                >
                  <div class="text-h6">Your connect link (Works only once!):</div>
                  <div class="column items-center">
                    <div class="text-no-wrap">
                      Session ID:
                      <span class="text-h6">{{ state.sessionId?.slice(0, 5) }}</span>
                    </div>
                    <QrCode :data="generatedSharingLink" show-fullscreen />
                    <div class="row no-wrap items-center">
                      <div class="text-bold q-pr-sm">{{ generatedSharingLink }}</div>
                      <q-btn
                        flat
                        :icon="matContentCopy"
                        @click="copyToClipboard(generatedSharingLink)"
                      />
                    </div>
                  </div>
                  <div>Open the link and confirm the new device!</div>
                </div>
                <div v-else class="text-warning">Error: Could not generate sharing secret!</div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn label="Ok" flat @click="showProvisioningDialog = false" />
              </q-card-actions>
            </q-card>
          </q-dialog>
        </q-btn>
        <q-btn
          flat
          label="Reconnect with a different Gdrive user"
          :icon="mdiConnection"
          @click="
            tystate.getGdriveToken({
              forceAccountSelection: true,
              forceReauth: true,
            })
          "
        />
        <q-btn
          flat
          label="Delete all pending sharing keys"
          :icon="matKeyOff"
          @click="gdp?.clearAllKeys"
        />
      </q-item-section>
    </q-item>
  </q-list>
  <q-card-actions v-if="showDontAskOption">
    <q-btn flat label="Later" @click="handleDismiss" />
    <q-checkbox v-model="dontAskAgain" label="Don't ask again" size="sm" />
  </q-card-actions>
</template>

<script setup lang="ts">
import { matContentCopy, matDevices, matKeyOff, matSync } from '@quasar/extras/material-icons'
import { mdiConnection, mdiGoogleDrive } from '@quasar/extras/mdi-v6'
import InfoDialog from '@taskyon/shared/components/InfoDialog.vue'
import QrCode from '@taskyon/shared/components/QrCode.vue'
import { copyToClipboard } from '@taskyon/shared/modules/utils'
import { computedAsync } from '@vueuse/core'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { ref } from 'vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()
const gdp = computedAsync(async () => await tystate.gdp)

const uploadingSK = ref(false)
const generatedSharingLink = ref<string>()
const showProvisioningDialog = ref(false)
const uploadSK = async () => {
  try {
    uploadingSK.value = true
    const pwd = await tystate.uploadSessionKey()
    generatedSharingLink.value = window.location.origin + `/connect/gd#${pwd}`
    showProvisioningDialog.value = true
  } catch (err) {
    console.error(err)
  } finally {
    uploadingSK.value = false
  }
}

const { title = undefined, showDontAskOption = false } = defineProps<{
  title?: string
  showDontAskOption?: boolean
}>()

const emit = defineEmits<{
  connect: [dontAskAgain: boolean]
  dismiss: [dontAskAgain: boolean]
}>()

const dontAskAgain = ref(false)

const handleDismiss = () => {
  emit('dismiss', dontAskAgain.value)
}
</script>
