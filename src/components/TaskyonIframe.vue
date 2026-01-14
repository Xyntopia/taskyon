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
import { deepMerge } from '../../packages/taskyon/src/utils/objHelpers'
import type { partialTyConfiguration } from '../../packages/tyclient/src'
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

const taskyonUrl = window.location.origin
const onIframeLoaded = () => {
  const configuration: partialTyConfiguration = deepMerge(
    {
      llmSettings: {
        //selectedApi: 'taskyon',
        enableOpenAiTools: false,
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
  void initializeTaskyon({ tools, configuration, name, persist })
}
</script>
