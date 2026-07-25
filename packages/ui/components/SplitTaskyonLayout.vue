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
import { ref } from 'vue'
import DockView, { type DockNode } from './DockView.vue'

const props = withDefaults(
  defineProps<{
    name: string
    persist?: boolean
    storageKeyPrefix?: string
    chatInitiallyCollapsed?: boolean
  }>(),
  {
    persist: false,
    storageKeyPrefix: 'SplitTaskyonView',
    chatInitiallyCollapsed: true,
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
      size: 70,
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
      collapsed: props.chatInitiallyCollapsed,
    },
  ],
})

if (props.persist) {
  syncRefsWithLocalStorage(
    `${props.storageKeyPrefix}:${props.name}`,
    {
      layout,
    },
    { debounceMs: 250 },
  )
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
