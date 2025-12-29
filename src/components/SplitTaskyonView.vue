<template>
  <DockView v-model:node="layout" class="col" hide-tab-add hide-tab-close>
    <template #app>
      <slot name="default" />
    </template>
    <template #chat>
      <!-- Taskyon iframe -->
      <iframe
        v-if="configuration"
        id="taskyon"
        title="Taskyon agent"
        frameborder="0"
        :src="`${taskyonUrl}?iframe=true&profile=coding`"
        style="width: 100%; height: 99%"
        @load="onIframeLoaded"
      ></iframe>
      <div v-else class="column items-center justify-center full-height">
        <div>Initializing Agent...</div>
        <q-spinner-dots size="50px" />
      </div>
    </template>
  </DockView>
</template>

<script setup lang="ts">
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { ref } from 'vue'
import { deepMerge } from '../../packages/taskyon/src/utils/objHelpers'
import { type ClientTool, initializeTaskyon } from '../../packages/tyclient/src'

const {
  tools = [],
  configuration: config = {},
  persist = false,
  name,
} = defineProps<{
  tools: ClientTool[]
  configuration: partialTyConfiguration | null
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

const layout = ref<DockNode>({
  id: 'root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'before',
      type: 'leaf',
      showTabs: 'never',
      views: ['app'],
      size: 30,
      activeViewIndex: 0,
    },
    {
      id: 'chat',
      type: 'leaf',
      showTabs: 'never',
      views: ['chat'],
      size: 30,
      activeViewIndex: 0,
    },
  ],
})
</script>
