<template>
  <DockView v-model:node="layout" class="col" hide-tab-add hide-tab-close>
    <template #app>
      <slot name="default" />
    </template>
    <template #chat>
      <TaskyonIframe v-bind="taskyonIframeProps" />
    </template>
  </DockView>
</template>

<script setup lang="ts">
import type { DockNode } from './DockView.vue'
import DockView from './DockView.vue'
import { syncRefsWithLocalStorage } from '../modules/saveState'
import type { partialTyConfiguration } from '../../tyclient/src'
import { computed, ref } from 'vue'
import { type ClientTool } from '../../tyclient/src'
import TaskyonIframe from './TaskyonIframe.vue'

const props = withDefaults(
  defineProps<{
  tools?: ClientTool[]
  configuration?: partialTyConfiguration | null
  persist?: boolean
  name: string
  profileName?: string
  bindingKey?: CryptoKey | string | null
  missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  }>(),
  {
    tools: () => [],
    configuration: () => ({}),
    persist: false,
    bindingKey: null,
    missingBindingKeyPolicy: 'deriveFromProfile',
  },
)

const taskyonIframeProps = computed(() => {
  const nextProps: {
    configuration: partialTyConfiguration | null
    tools: ClientTool[]
    persist: boolean
    name: string
    profileName?: string
    bindingKey?: CryptoKey | string | null
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  } = {
    configuration: props.configuration,
    tools: props.tools,
    persist: props.persist,
    name: props.name,
  }
  if (typeof props.profileName === 'string') nextProps.profileName = props.profileName
  if (props.bindingKey !== null) nextProps.bindingKey = props.bindingKey
  if (props.missingBindingKeyPolicy !== 'deriveFromProfile') {
    nextProps.missingBindingKeyPolicy = props.missingBindingKeyPolicy
  }
  return nextProps
})

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
  `SplitTaskyonView:${props.name}`,
  {
    layout,
  },
  { debounceMs: 250 },
)
</script>
