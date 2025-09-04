<template>
  <q-page padding>
    Connect Taskyon to
    {{ method }}
    {{ secret }}
    {{ incomingSessionId?.slice(0, 5) }}
    {{ existingSessionId?.slice(0, 5) }}
    <q-btn
      v-if="!incomingSessionId"
      flat
      label="Verify Connection!"
      @click="provisonFromGdrive(secret)"
    ></q-btn>
    <q-btn
      v-else-if="incomingSessionId !== existingSessionId"
      flat
      label="Connect Device!"
      @click="setNewSessionKey"
    />
  </q-page>
</template>

<script setup lang="ts">
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

const existingSessionId = asyncComputed(tystate.getSessionId, undefined)

const route = useRoute()
const secret = route.hash.slice(1)

const provisonFromGdrive = async (secret: string) => {
  temporarySession.value = await tystate.newSessionFromSecret(secret)
}

const setNewSessionKey = async () => {
  if (temporarySession.value) await tystate.setNewSession(temporarySession.value)
}

//route.hash = ''
</script>
