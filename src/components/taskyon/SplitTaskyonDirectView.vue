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
      <DirectTaskyonAgent
        :configuration="configuration"
        :tools="tools"
        :profile-name="profileName"
        :binding-key="bindingKey"
      />
    </template>
  </SplitTaskyonLayout>
</template>

<script setup lang="ts">
import type { ClientTool } from '@taskyon/taskyon/api'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import SplitTaskyonLayout from '@taskyon/ui/components/SplitTaskyonLayout.vue'
import DirectTaskyonAgent from './DirectTaskyonAgent.vue'

withDefaults(
  defineProps<{
    tools?: ClientTool[]
    configuration?: partialTyConfiguration | null
    persist?: boolean
    name: string
    profileName: string
    bindingKey?: CryptoKey | string | null
    initialChatOpen?: boolean
    chatSize?: number
  }>(),
  {
    tools: () => [],
    configuration: () => ({}),
    persist: false,
    bindingKey: null,
    initialChatOpen: false,
    chatSize: 50,
  },
)
</script>
