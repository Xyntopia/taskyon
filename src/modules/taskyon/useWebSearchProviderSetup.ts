import { computed, onUnmounted, ref } from 'vue'
import { generateSecretId } from '@taskyon/taskyon'
import { createMediatedFetch } from '@taskyon/common/modules/webFetching/mediatedFetch'
import {
  requestWebSearch,
  webSearchKeyName,
  isWebSearchProvider,
  type WebSearchProvider,
} from '@taskyon/taskyon/tools/webSearchTool'
import { useAppStateStore } from 'src/stores/appState'
import { authorizeBrowserSandboxFetch, useTaskyonStore } from 'src/stores/taskyonState'
import { useQuasar } from 'quasar'

export function useWebSearchProviderSetup() {
  const appState = useAppStateStore()
  const taskyonState = useTaskyonStore()
  const $q = useQuasar()
  const initialProvider = computed(() => {
    const configured = appState.effectiveToolchainConfig.webSearch?.provider
    return typeof configured === 'string' && isWebSearchProvider(configured)
      ? configured
      : 'tinyfish'
  })
  const visible = ref(false)
  const testing = ref(false)
  const error = ref('')
  const pendingSecretIds = new Set<string>()
  let disposed = false
  const pendingSearches = new Set<(provider: string) => void>()

  const settlePending = (provider: string) => {
    for (const respond of pendingSearches) respond(provider)
    pendingSearches.clear()
    pendingSecretIds.clear()
  }

  const cancel = () => {
    if (testing.value) return
    visible.value = false
    error.value = ''
    settlePending('')
  }

  const open = (respond?: (provider: string) => void, secretId?: string) => {
    if (respond) pendingSearches.add(respond)
    if (secretId) pendingSecretIds.add(secretId)
    error.value = ''
    visible.value = true
  }

  onUnmounted(() => {
    disposed = true
    settlePending('')
  })

  const saveAndTest = async (value: { provider: WebSearchProvider; apiKey: string }) => {
    if (testing.value) return
    testing.value = true
    error.value = ''
    try {
      const resolved = await taskyonState.taskyonClient.tools.resolve({ name: 'webSearch' })
      if (!resolved) throw new Error('The webSearch tool is not available.')
      const mediatedFetch = createMediatedFetch({
        authorize: (capability) =>
          authorizeBrowserSandboxFetch({
            tool: resolved.identity,
            capability,
          }),
        fetch: globalThis.fetch.bind(globalThis),
        maxResponseBytes: 1_000_000,
      })
      // A successful authenticated request is required before a key is saved as working.
      await requestWebSearch(value.provider, 'Taskyon open source', 1, value.apiKey, mediatedFetch)
      if (disposed) return
      const ty = await taskyonState.taskyon
      const activeSecretId = await generateSecretId(resolved.identity.revision, resolved.tool)
      // The pending call may have a pinned revision different from the active tool.
      const secretIds = pendingSecretIds.size ? [...pendingSecretIds] : [activeSecretId]
      for (const id of secretIds) {
        await ty.setSecret(id, webSearchKeyName(value.provider), value.apiKey)
      }
      appState.setActiveToolchainValue(['webSearch', 'provider'], value.provider)
      visible.value = false
      settlePending(value.provider)
      $q.notify({ type: 'positive', message: `Connected to ${value.provider} web search.` })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Web search connection failed.'
    } finally {
      testing.value = false
    }
  }

  return { visible, testing, error, initialProvider, open, cancel, saveAndTest }
}
