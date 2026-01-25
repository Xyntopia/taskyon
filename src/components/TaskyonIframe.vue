<template>
  <!-- Taskyon iframe -->
  <iframe
    v-if="config"
    id="taskyon"
    title="Taskyon agent"
    frameborder="0"
    :src="`${taskyonUrl}?iframe=true&profile=${name}`"
    style="width: 100%; height: 99%"
    @load="onIframeLoaded"
  ></iframe>
  <div v-else class="column items-center justify-center full-height">
    <div>Initializing Agent...</div>
    <q-spinner-dots size="50px" />
  </div>
</template>

<script setup lang="ts">
import { watchEffect } from 'vue'
import { deepMerge } from '../../packages/taskyon/src/utils/objHelpers'
import type { partialTyConfiguration, TyClient } from '../../packages/tyclient/src'
import { type ClientTool, initializeTaskyon } from '../../packages/tyclient/src'

const {
  tools = [],
  configuration: config = {},
  persist = false,
  name,
} = defineProps<{
  tools?: ClientTool[]
  configuration?: partialTyConfiguration | null
  persist?: boolean
  name: string
}>()

const mergeConfig = (config: partialTyConfiguration | null) => {
  const configuration: partialTyConfiguration = deepMerge(
    {
      llmSettings: {
        //selectedApi: 'taskyon',
        enableToolChooser: true,
      },
      appConfiguration: {
        guiMode: 'minChat',
        showLogo: false,
        // TODO: chatSuggestions: [gettingStarted],
        welcomeMsg: 'Taskyon Split View!',
      },
    },
    config,
  )
  return configuration
}

const taskyonUrl = window.location.origin
let tyAgent: TyClient | undefined = undefined
const onIframeLoaded = async () => {
  tyAgent = await initializeTaskyon({
    tools,
    configuration: mergeConfig(config),
    name,
    persist,
    iframeId: 'taskyon',
  })
}

watchEffect(() => {
  if (tyAgent)
    tyAgent.reconfigure({
      tools,
      configuration: mergeConfig(config),
      name,
      persist,
    })
})
</script>
