<template>
  <iframe
    v-if="props.configuration"
    :id="iframeDomId"
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
import { computed, ref, watch } from 'vue'
import { deepMerge } from '@taskyon/common/modules/objHelpers'
import type { ClientTool, partialTyConfiguration } from '@taskyon/tyclient'
import { initializeTaskyon } from '@taskyon/tyclient'
import { cryptoKeyToBase64 } from '@taskyon/common/modules/crypto'

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
  }>(),
  {
    tools: () => [],
    configuration: () => ({}),
    persist: false,
    url: '',
    profileName: undefined,
    bindingKey: null,
    missingBindingKeyPolicy: 'deriveFromProfile',
  },
)

const mergeConfig = (config: partialTyConfiguration | null) => {
  const configuration: partialTyConfiguration = deepMerge(
    {
      llmSettings: {
        enableToolChooser: true,
      },
      appConfiguration: {
        guiMode: 'minChat',
        showLogo: false,
        welcomeMsg: 'Taskyon Split View!',
      },
    },
    config,
  )
  return configuration
}

const taskyonBaseUrl = computed(() => {
  const candidate = props.url?.trim()
  return candidate && candidate.length > 0 ? candidate : window.location.origin
})
const resolvedProfileName = computed(() => props.profileName ?? props.name)
const effectiveBindingKey = ref<CryptoKey | string | undefined>(undefined)
const iframeReloadSeed = ref(0)
const iframeDomId = 'taskyon'
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
  return `${taskyonBaseUrl.value}?${params.toString()}`
})

const toTransportBindingKey = async (
  key: CryptoKey | string | null,
): Promise<CryptoKey | string | undefined> => {
  if (typeof key === 'string' && key.trim()) return key
  if (key instanceof CryptoKey) {
    try {
      return await cryptoKeyToBase64(key)
    } catch (error) {
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
  iframeReloadSeed.value += 1
})

watch(
  () => props.configuration,
  (nextConfig, prevConfig) => {
    if (prevConfig === undefined) return
    if (nextConfig === prevConfig) return
    iframeReloadSeed.value += 1
  },
  { deep: true },
)

watch(
  () => props.tools,
  (nextTools, prevTools) => {
    if (prevTools === undefined) return
    if (nextTools === prevTools) return
    iframeReloadSeed.value += 1
  },
  { deep: true },
)

watch(
  () => props.persist,
  (nextPersist, prevPersist) => {
    if (prevPersist === undefined) return
    if (nextPersist === prevPersist) return
    iframeReloadSeed.value += 1
  },
)

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
    iframeId: iframeDomId,
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
  await initializeTaskyon(initOptions)
}
</script>
