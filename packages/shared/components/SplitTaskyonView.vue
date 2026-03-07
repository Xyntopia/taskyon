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
import type { DockNode } from './DockView.vue'
import DockView from './DockView.vue'
import { syncRefsWithLocalStorage } from '../modules/saveState'
import type { partialTyConfiguration } from '../../tyclient/src'
import { ref } from 'vue'
import { type ClientTool } from '../../tyclient/src'
import TaskyonIframe from './TaskyonIframe.vue'

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
      keepAliveViews: ['chat'],
      size: 30,
      activeViewIndex: 0,
      collapsed: true, // start with the chat collapsed
    },
  ],
})

syncRefsWithLocalStorage(
  `SplitTaskyonView:${name}`,
  {
    layout,
  },
  { debounceMs: 250 },
)
</script>
