<template>
  <q-card-section v-if="title" class="row items-center q-pb-none">
    <div class="text-h6">{{ title }}</div>
    <q-space />
    <q-btn v-close-popup icon="close" flat round dense />
  </q-card-section>
  <q-list>
    <div class="text-info">Keep task data synced across devices</div>
    <q-item>
      <q-item-section avatar>
        <q-icon size="md" :name="mdiGoogleDrive" />
      </q-item-section>
      <q-item-section>
        <div class="row q-gutter-sm no-wrap">
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
          <div>Connect Google Drive for automatic backup?</div>
        </div>
      </q-item-section>
      <q-item-section>
        <q-btn color="primary" label="Connect Google Drive" @click="handleConnect" />
      </q-item-section>
    </q-item>
  </q-list>
  <q-card-actions v-if="showDontAskOption">
    <q-btn flat label="Later" @click="handleDismiss" />
    <q-checkbox v-model="dontAskAgain" label="Don't ask again" size="sm" />
  </q-card-actions>
</template>

<script setup lang="ts">
import { mdiGoogleDrive } from '@quasar/extras/mdi-v6'
import { ref } from 'vue'
import InfoDialog from '../InfoDialog.vue'

const { title, showDontAskOption = false } = defineProps<{
  title?: string
  showDontAskOption?: boolean
}>()

const emit = defineEmits<{
  connect: [dontAskAgain: boolean]
  dismiss: [dontAskAgain: boolean]
}>()

const dontAskAgain = ref(false)

const handleConnect = () => {
  emit('connect', dontAskAgain.value)
}

const handleDismiss = () => {
  emit('dismiss', dontAskAgain.value)
}
</script>
