<template>
  <DockView v-model:node="layout" class="col" hide-tab-add hide-tab-close>
    <template #app>
      <slot name="default" />
    </template>
    <template #chat>
      <TaskyonIframe :configuration="config" :tools="tools" :persist="persist" :name="name" />
    </template>
  </DockView>
</template>

<script setup lang="ts">
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { ref } from 'vue'
import { type ClientTool } from '../../packages/tyclient/src'
import TaskyonIframe from './TaskyonIframe.vue'

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
