<template>
  <SplitTaskyonLayout
    :name="name"
    :persist="persist"
    :chat-size="chatSize"
    :chat-initially-collapsed="!initialChatOpen"
    class="col"
  >
    <slot />
    <template #chat>
      <TaskyonIframe v-bind="taskyonIframeProps" />
    </template>
  </SplitTaskyonLayout>
</template>

<script setup lang="ts">
import type { partialTyConfiguration } from '@taskyon/tyclient'
import { computed } from 'vue'
import { type ClientTool } from '@taskyon/tyclient'
import SplitTaskyonLayout from './SplitTaskyonLayout.vue'
import TaskyonIframe from './TaskyonIframe.vue'

const props = withDefaults(
  defineProps<{
    tools?: ClientTool[]
    configuration?: partialTyConfiguration | null
    persist?: boolean
    name: string
    url?: string
    profileName?: string | undefined
    bindingKey?: CryptoKey | string | null
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
    initialChatOpen?: boolean
    chatSize?: number
  }>(),
  {
    tools: () => [],
    configuration: () => ({}),
    persist: false,
    url: '',
    profileName: undefined,
    bindingKey: null,
    missingBindingKeyPolicy: 'deriveFromProfile',
    initialChatOpen: false,
    chatSize: 50,
  },
)

const taskyonIframeProps = computed(() => {
  const nextProps: {
    configuration: partialTyConfiguration | null
    tools: ClientTool[]
    persist: boolean
    name: string
    url?: string
    profileName?: string
    bindingKey?: CryptoKey | string | null
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  } = {
    configuration: props.configuration,
    tools: props.tools,
    persist: props.persist,
    name: props.name,
  }
  if (typeof props.url === 'string' && props.url.trim().length > 0) nextProps.url = props.url
  if (typeof props.profileName === 'string') nextProps.profileName = props.profileName
  if (props.bindingKey !== null) nextProps.bindingKey = props.bindingKey
  if (props.missingBindingKeyPolicy !== 'deriveFromProfile') {
    nextProps.missingBindingKeyPolicy = props.missingBindingKeyPolicy
  }
  return nextProps
})
</script>
