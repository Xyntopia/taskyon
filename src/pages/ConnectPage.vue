<template>
  <q-page padding>
    Connect Taskyon to
    {{ method }}
    {{ secret }}
    {{ incomingSessionId?.slice(0, 5) }}
    {{ existingSessionId?.slice(0, 5) }}
    <q-btn flat label="Connect this device!" @click="provisonFromGdrive(secret)"></q-btn>
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

//route.hash = ''
</script>
