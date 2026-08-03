<template>
  <DockView v-model:node="layout" class="split-taskyon-layout col" hide-tab-add hide-tab-close>
    <template #app>
      <slot />
    </template>
    <template #chat>
      <slot name="chat" />
    </template>
  </DockView>
</template>

<script setup lang="ts">
import { syncRefsWithLocalStorage } from '@taskyon/common/modules/saveState'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import { ref } from 'vue'
import type { DockNode } from './dockLayout'
import DockView from './DockView.vue'
import { syncStateWithStorageClient } from '../modules/storageState'

const props = withDefaults(
  defineProps<{
    name: string
    persist?: boolean
    storageClient?: TaskyonStorageClient
    storageKeyPrefix?: string
    chatInitiallyCollapsed?: boolean
    chatSize?: number
  }>(),
  {
    persist: false,
    storageKeyPrefix: 'SplitTaskyonView',
    chatInitiallyCollapsed: true,
    chatSize: 30,
  },
)

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
      size: 100 - props.chatSize,
      activeViewIndex: 0,
    },
    {
      id: 'chat',
      type: 'leaf',
      showTabs: 'never',
      views: ['chat'],
      keepAliveViews: ['chat'],
      size: props.chatSize,
      activeViewIndex: 0,
      collapsed: props.chatInitiallyCollapsed,
    },
  ],
})

if (props.persist) {
  if (props.storageClient) {
    void syncStateWithStorageClient(
      props.storageClient,
      { namespace: 'ui/split-layouts/v1', id: `${props.storageKeyPrefix}:${props.name}` },
      { layout },
    )
  } else {
    syncRefsWithLocalStorage(
      `${props.storageKeyPrefix}:${props.name}`,
      { layout },
      { debounceMs: 250 },
    )
  }
}
</script>

<style scoped lang="sass">
@media (max-width: 720px)
  .split-taskyon-layout.dock-row
    flex-direction: column

    :deep(> .dock-node)
      min-height: 0

    :deep(> .dock-splitter)
      display: none
</style>
