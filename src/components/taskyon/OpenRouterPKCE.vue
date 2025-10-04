<template>
  <div class="row items-center">
    <div class="col">
      <q-btn
        class="fit"
        label="Connect Taskyon to Openrouter.ai AI service"
        :icon="matKey"
        no-caps
        outline
        @click="onGetOpenRouterKey"
      >
      </q-btn>
    </div>
    <div class="col-auto">
      <InfoDialog
        info-text="
www.openrouter.ai is a service which brings you a large number of AI
models: Once registered you have access to a large number of models:

GPT3/4, Google Palm, LLama2/3  and more..

By clicking on this button you can connect taskyon to openrouter.ai service.
"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { matKey } from '@quasar/extras/material-icons'
import axios from 'axios'
import InfoDialog from 'components/InfoDialog.vue'
import { Notify } from 'quasar'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const state = useAppStateStore()
const tysstate = useTaskyonStore()
const route = useRoute()

const callbackUrl = window.location.origin + '/settings/aiserviceprovider' // This will get the base URL of your application

const authURL = computed(() => {
  console.log('get current URL')
  return `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}`
})

async function onGetOpenRouterKey() {
  await tysstate.setProviderApiKey('openrouter.ai')
  window.location.href = authURL.value
}

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0]
    window.history.pushState({}, document.title, baseUrl)
  }
}

let loadingKey = false
async function getOpenRouterPKCEKey(code: string) {
  if (loadingKey == false) {
    console.log('start openai PKCE')
    loadingKey = true
    try {
      const response = await axios.post<{ key: string }>('https://openrouter.ai/api/v1/auth/keys', {
        code: code,
      })
      const data = response.data
      console.log('downloaded key:', data.key)
      if (data.key) {
        Notify.create('API Key retrieved successfully')
        await tysstate.setProviderApiKey('openrouter.ai', data.key)
        state.llmSettings.selectedApi = 'openrouter.ai'
      } else {
        Notify.create('Failed to retrieve API Key')
      }
    } catch (error) {
      console.error('Error fetching API Key:', error)
      Notify.create('Error occurred while fetching API Key')
    }
    removeCodeFromUrl() // Remove the 'code' from URL
    loadingKey = false
  }
}

async function checkForApiKey() {
  const code = route.query['code'] as string | undefined
  if (code) {
    console.log('found code in URL:', code)
    await getOpenRouterPKCEKey(code)
  }
}

onMounted(() => {
  void checkForApiKey()
})
</script>
