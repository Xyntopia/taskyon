<template>
  <!-- Taskyon iframe -->
  <iframe
    v-if="props.configuration"
    id="taskyon"
    :key="iframeDomKey"
    title="Taskyon agent"
    frameborder="0"
    :src="iframeSrc"
    allow="clipboard-read; clipboard-write"
    style="width: 100%; height: 99%"
    @load="onIframeLoaded"
  ></iframe>
  <div v-else class="column items-center justify-center full-height">
    <div>Initializing Agent...</div>
    <q-spinner-dots size="50px" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { deepMerge } from '../modules/objHelpers'
import type { partialTyConfiguration, TyClient } from '../../tyclient/src'
import { type ClientTool, initializeTaskyon } from '../../tyclient/src'
import { cryptoKeyToBase64 } from '../modules/crypto'

const props = withDefaults(
  defineProps<{
    tools?: ClientTool[]
    configuration?: partialTyConfiguration | null
    persist?: boolean
    name: string
    profileName?: string | undefined
    bindingKey?: CryptoKey | string | null
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  }>(),
  {
    tools: () => [],
    configuration: () => ({}),
    persist: false,
    profileName: undefined,
    bindingKey: null,
    missingBindingKeyPolicy: 'deriveFromProfile',
  },
)

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
const resolvedProfileName = computed(() => props.profileName ?? props.name)
const effectiveBindingKey = ref<CryptoKey | string | undefined>(undefined)
const iframeReloadSeed = ref(0)
const iframeDomKey = computed(
  () =>
    `${resolvedProfileName.value}:${
      typeof effectiveBindingKey.value === 'string'
        ? effectiveBindingKey.value
        : effectiveBindingKey.value
          ? 'crypto-key'
          : 'no-key'
    }:${iframeReloadSeed.value}`,
)
const iframeSrc = computed(() => {
  const params = new URLSearchParams({
    iframe: 'true',
    profile: resolvedProfileName.value,
  })
  if (props.missingBindingKeyPolicy === 'noBindingKey' && !effectiveBindingKey.value) {
    params.set('nobindingkey', '1')
  }
  return `${taskyonUrl}?${params.toString()}`
})
let tyAgent: TyClient | undefined = undefined

const toTransportBindingKey = async (
  key: CryptoKey | string | null,
): Promise<CryptoKey | string | undefined> => {
  if (typeof key === 'string' && key.trim()) return key
  if (key instanceof CryptoKey) {
    try {
      // Prefer string payload for deterministic transport when key is exportable.
      return await cryptoKeyToBase64(key)
    } catch (error) {
      // Non-extractable keys cannot be exported; use structured-clone transport.
      console.warn('binding key export failed; falling back to raw CryptoKey transport', error)
      return key
    }
  }
  return undefined
}

watch(
  () => props.bindingKey,
  async (nextBindingKey) => {
    effectiveBindingKey.value = await toTransportBindingKey(nextBindingKey)
  },
  { immediate: true },
)

watch([resolvedProfileName, effectiveBindingKey], ([nextProfile, nextBinding], oldValues) => {
  const [oldProfile, oldBinding] = oldValues ?? [undefined, undefined]
  if (oldProfile === undefined && oldBinding === undefined) return
  if (nextProfile === oldProfile && nextBinding === oldBinding) return
  // Force a clean iframe bootstrap when session context changes.
  tyAgent = undefined
  iframeReloadSeed.value += 1
})

const onIframeLoaded = async () => {
  const initOptions: {
    tools: ClientTool[]
    configuration: partialTyConfiguration
    name: string
    persist: boolean
    iframeId: string
    profileName?: string
    bindingKey?: CryptoKey | string
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  } = {
    tools: props.tools,
    configuration: mergeConfig(props.configuration),
    name: props.name,
    persist: props.persist,
    iframeId: 'taskyon',
  }
  if (!effectiveBindingKey.value && props.missingBindingKeyPolicy) {
    initOptions.missingBindingKeyPolicy = props.missingBindingKeyPolicy
  }
  if (typeof resolvedProfileName.value === 'string') {
    initOptions.profileName = resolvedProfileName.value
  }
  if (effectiveBindingKey.value) {
    initOptions.bindingKey = effectiveBindingKey.value
  }
  tyAgent = await initializeTaskyon(initOptions)
}

watchEffect(() => {
  if (tyAgent) {
    const reconfigureOptions: {
      tools: ClientTool[]
      configuration: partialTyConfiguration
      name: string
      persist: boolean
      profileName?: string
      bindingKey?: CryptoKey | string
      missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
    } = {
      tools: props.tools,
      configuration: mergeConfig(props.configuration),
      name: props.name,
      persist: props.persist,
    }
    if (!effectiveBindingKey.value && props.missingBindingKeyPolicy) {
      reconfigureOptions.missingBindingKeyPolicy = props.missingBindingKeyPolicy
    }
    if (typeof resolvedProfileName.value === 'string') {
      reconfigureOptions.profileName = resolvedProfileName.value
    }
    if (effectiveBindingKey.value) {
      reconfigureOptions.bindingKey = effectiveBindingKey.value
    }
    tyAgent.reconfigure(reconfigureOptions)
  }
})
</script>
