<template>
  <q-page padding>
    <div v-if="!incomingSessionId">
      <q-btn
        flat
        label="Click here to connect to Gdrive and verify the new Taskyon session!"
        no-caps
        @click="downloadKeyFromGdrive(secret)"
      ></q-btn>
    </div>
    <div v-else-if="incomingSessionId !== existingSessionId">
      <icon :name="matWarning" />
      Before pressing the button below, confirm, that the previous device shows the following
      Session ID:
      <span class="text-h6">{{ incomingSessionId.slice(0, 5) }}</span>

      If they are the same, you can proceed to connect!
      <q-btn flat label="Connect Device!" @click="setNewSessionKey" />
    </div>
    <div v-else-if="incomingSessionId === existingSessionId">
      Taskyon is now successfully connected to session {{ existingSessionId?.slice(0, 5) }}.
    </div>
    <div v-else>something went wrong...</div>
    <div v-if="error">{{ error }}</div>
  </q-page>
</template>

<script setup lang="ts">
import { matWarning } from '@quasar/extras/material-icons'
import { type CryptoSession } from '@taskyon/taskyon'
import { asyncComputed } from 'src/modules/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { ref } from 'vue'
import { useRoute } from 'vue-router'

defineProps<{
  method?: string
}>()

const temporarySession = ref<CryptoSession>()

const incomingSessionId = asyncComputed(
  async () => await temporarySession.value?.getSessionId(),
  undefined,
)

const tystate = useTaskyonStore()

const existingSessionId = ref<string>()
void tystate.getSessionId().then((id) => (existingSessionId.value = id))

const route = useRoute()
const secret = route.hash.slice(1)
const error = ref<string>()

const downloadKeyFromGdrive = async (secret: string) => {
  try {
    temporarySession.value = await tystate.newSessionFromGdrive(secret)
  } catch (err) {
    error.value = `Could not verify the key! (${err instanceof Error ? err.message : String(err)})`
  }
}

const setNewSessionKey = async () => {
  if (temporarySession.value) {
    await tystate.setNewSession(temporarySession.value, true)
  }
  // recalculate new session id..
  existingSessionId.value = await tystate.getSessionId()
}

//route.hash = ''
</script>
