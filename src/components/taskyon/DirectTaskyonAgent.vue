<template>
  <TaskyonClientPane
    v-model:selected-task-id="selectedTaskId"
    v-model:recent-task-ids="recentTaskIds"
    :client="client"
    :entry-node="entryNode"
    :status="status"
    :error-message="errorMessage"
    :all-tools="allTools"
    :welcome-message="configuration?.appConfiguration?.welcomeMsg as string | undefined"
    :expert-mode="configuration?.appConfiguration?.expertMode === true"
    :chat-completion-stream="chatCompletionStream"
    :worker-stream="workerStream"
  />
</template>

<script setup lang="ts">
import { deepMerge } from '@taskyon/common/modules/objHelpers'
import { syncRefsWithLocalStorage } from '@taskyon/common/modules/saveState'
import type { StreamSubscription } from '@taskyon/common/modules/frpBus'
import {
  createTaskyonBrowserCoreRuntime,
  initCryptoSessionFromBrowser,
} from '@taskyon/runtime-browser'
import type { ChatCompletionStreamEvent, TyTaskStreamData } from '@taskyon/taskyon'
import {
  registerToolRpcTools,
  setTaskyonProviderCredential,
  toolCall,
  type ClientTool,
  type TaskyonClient,
  type ToolBase,
} from '@taskyon/taskyon/api'
import { createDefaultTaskyonToolSetup } from '@taskyon/taskyon/tools'
import { createStandardEntryNodeTool } from '@taskyon/taskyon/tools/entryNode'
import { createStorageWorkspaceOperations } from '@taskyon/taskyon/tools/storageWorkspaceOperations'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import TaskyonClientPane from '@taskyon/ui/components/TaskyonClientPane.vue'
import { useAppStateStore } from 'src/stores/appState'
import {
  authorizeBrowserPopup,
  authorizeBrowserSandboxFetch,
  createBrowserProxyFetch,
  createTrustedUiToolContext,
  defineTyGuiTools,
  useTaskyonStore,
} from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    configuration?: partialTyConfiguration | null
    tools?: ClientTool[]
    profileName: string
    bindingKey?: CryptoKey | string | null
  }>(),
  { tools: () => [], configuration: () => ({}) },
)

const appState = useAppStateStore()
const taskyonStore = useTaskyonStore()
const client = shallowRef<TaskyonClient>()
const allTools = shallowRef<Record<string, ToolBase>>({})
const status = ref<'starting' | 'ready' | 'error'>('starting')
const errorMessage = ref('Taskyon could not be started.')
const chatCompletionStream = shallowRef<StreamSubscription<ChatCompletionStreamEvent>>()
const workerStream = shallowRef<StreamSubscription<TyTaskStreamData>>()
const selectedTaskId = ref<string>()
const recentTaskIds = ref<string[]>([])
syncRefsWithLocalStorage(
  `DirectTaskyonAgent:${props.profileName}`,
  {
    selectedTaskId,
    recentTaskIds,
  },
  { debounceMs: 250 },
)

const entryFunction = computed(() =>
  typeof props.configuration?.llmSettings?.entryFunction === 'string'
    ? props.configuration.llmSettings.entryFunction
    : appState.llmSettings.entryFunction,
)
const entryNode = computed(() => toolCall({ name: entryFunction.value, arguments: {} }))
let generation = 0
let stopRuntime: (() => Promise<void>) | undefined
let activeSessionId: string | undefined

watch(
  () =>
    [
      appState.taskyonSessionStatus,
      appState.sessionId,
      appState.effectiveToolchainConfig,
      taskyonStore.currentKeyString,
      props.configuration,
      props.bindingKey,
      props.profileName,
    ] as const,
  async () => {
    const current = ++generation
    const previousStop = stopRuntime
    stopRuntime = undefined
    await previousStop?.()
    if (current !== generation) return
    client.value = undefined
    status.value = 'starting'
    if (appState.taskyonSessionStatus !== 'ready' || !props.configuration) return

    let runtime: ReturnType<typeof createTaskyonBrowserCoreRuntime> | undefined
    try {
      const mainCore = await taskyonStore.taskyon
      const sessionId = await mainCore.getCryptoSession().getSessionId()
      if (current !== generation) return
      if (activeSessionId && activeSessionId !== sessionId) {
        selectedTaskId.value = undefined
        recentTaskIds.value = []
      }
      activeSessionId = sessionId
      const scope = `${props.profileName}-${sessionId}`
      const key = props.bindingKey instanceof CryptoKey ? props.bindingKey : undefined
      const toolchainConfig = deepMerge(
        appState.effectiveToolchainConfig,
        props.configuration.toolchainProfiles?.base ?? {},
      )
      const provider = toolchainConfig.chatCompletion?.provider
      runtime = createTaskyonBrowserCoreRuntime({
        llmSettings: () => ({ ...appState.llmSettings, entryFunction: entryFunction.value }),
        entryNode: () => entryNode.value,
        toolchainConfig,
        cryptoSession: initCryptoSessionFromBrowser(key ? { bindingKey: key } : undefined, true, {
          namespace: scope,
        }),
        storageSessionId: scope,
        storage: { kind: 'browser' },
        authorizeSandboxFetch: authorizeBrowserSandboxFetch,
        authorizePopup: authorizeBrowserPopup,
        createFetchWithPolicy: (storageClient) =>
          createBrowserProxyFetch(
            storageClient,
            appState.appConfiguration.sandboxFetchProxyUrl,
            () => Promise.resolve(taskyonStore.getTaskyonKeyString() ?? ''),
          ),
        fetchPolicy: { policy: 'proxy' },
        toolSetup: (storageClient) =>
          createDefaultTaskyonToolSetup({
            storageClient,
            workspaceOperations: createStorageWorkspaceOperations(
              storageClient,
              'workspace-files/v1',
            ),
          }),
      })
      stopRuntime = () => runtime!.stop('App assistant closed')
      const core = await runtime.taskyon
      if (current !== generation) return
      const credential = taskyonStore.currentKeyString
      if (typeof provider === 'string' && credential) {
        await setTaskyonProviderCredential(runtime.host, provider, credential)
      }
      const entryTool = createStandardEntryNodeTool({
        name: entryFunction.value,
        renderOptions: { hideChat: true, hideLlm: true },
      })
      const tools = props.tools.some((tool) => tool.name === entryFunction.value)
        ? props.tools
        : [entryTool, ...props.tools]
      const registration = await registerToolRpcTools({
        port: runtime.port,
        tools: [
          ...tools,
          ...defineTyGuiTools(appState, core, runtime.client, taskyonStore.documentationBases),
        ],
        createContext: createTrustedUiToolContext(core, runtime.client),
      })
      if (current !== generation) {
        registration.destroy()
        return
      }
      stopRuntime = async () => {
        registration.destroy()
        await runtime!.stop('App assistant closed')
      }
      allTools.value = await runtime.client.tools.list({ includeHidden: true })
      client.value = runtime.client
      chatCompletionStream.value = core.chatCompletionStream
      workerStream.value = core.workerStream
      status.value = 'ready'
    } catch (error) {
      if (current !== generation) return
      errorMessage.value = error instanceof Error ? error.message : String(error)
      status.value = 'error'
      await runtime?.stop('App assistant failed to start')
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation += 1
  void stopRuntime?.()
})
</script>
