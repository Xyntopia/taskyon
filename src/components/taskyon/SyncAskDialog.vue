<template>
  <q-card-section v-if="title" class="row items-center q-pb-none">
    <div class="text-h6">{{ title }}</div>
    <q-space />
    <q-btn v-close-popup icon="close" flat round dense />
  </q-card-section>
  <q-list dense class="col">
    <q-item class="text-center text-yellow">
      <div class="col">Gdrive Sync is experimental!</div>
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
          <div>Connect Google Drive for automatic backup?</div>
          <InfoDialog>
            <p>
              You can optionally use your Google Drive to sync your task nodes across devices. This
              makes it easy to access your tasks from anywhere.
            </p>
            <p>
              For your privacy, all tasks are always encrypted before being saved in Google Drive.
              Only you can access your task data. Google will not able to read your data.
            </p>
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
      <q-item-section>
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
      </q-item-section>
    </q-item>
  </q-list>
  <q-card-actions v-if="showDontAskOption">
    <q-btn flat label="Later" @click="handleDismiss" />
    <q-checkbox v-model="dontAskAgain" label="Don't ask again" size="sm" />
  </q-card-actions>
</template>

<script setup lang="ts">
import { mdiConnection, mdiGoogleDrive } from '@quasar/extras/mdi-v6'
import { ref } from 'vue'
import InfoDialog from '../InfoDialog.vue'
import { useAppStateStore } from 'src/stores/appState'
import { matSync } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computedAsync } from '@vueuse/core'

const state = useAppStateStore()
const tystate = useTaskyonStore()
const gdp = computedAsync(async () => await tystate.gdp)

const { title, showDontAskOption = false } = defineProps<{
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
