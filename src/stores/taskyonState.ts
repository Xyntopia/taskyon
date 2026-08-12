import type {
  Asyncify,
  CryptoSession,
  InternalTool,
  KeyString,
  ModelCard,
  partialTaskDraft,
  Port,
  TaskNodeMeta,
  Taskyon,
  TaskyonMessageType,
  ToolRpcCreateContext,
  ToolBase,
  ToolIdentity,
  CapabilityScope,
  Thunk,
  tyPublicApiKeyObject,
  TyTaskStreamData,
} from '@taskyon/taskyon'
import {
  base64ToPublixX25519,
  createClientTool,
  createCapabilityPolicy,
  createPersistentTaskTemplateCache,
  createTaskTemplateRenderer,
  createPortClient,
  createPgLiteTaskManagerStorageService,
  createSubtasksResult,
  createPortServer,
  createProtocolPort,
  createStream,
  createTypeFilteredPort,
  cryptoKeyToBase64,
  deriveKeyFromPwd,
  ensureValidTaskId,
  exclusive,
  getToolchainProviderProfiles,
  getDatabase,
  getDefaultParametersForTool,
  generateSecretId,
  isTaskyonKey,
  latestOnly,
  fetchModelsForProvider,
  findCallingToolReference,
  OAUTH_PROVIDERS,
  randomString,
  registerToolRpcTools,
  TaskNode,
  taskyonRuntimeProtocol,
} from '@taskyon/taskyon'
import type { ChatCompletionStreamEvent } from '@taskyon/taskyon'
import {
  createPersistentOauthTokenGetter,
  OAUTH_CREDENTIALS_SECRET_PREFIX,
} from '@taskyon/taskyon/browser'
import type { AuthenticationOptions, TokenGetter } from '@taskyon/taskyon/browser'
import { createOAuthTool } from '@taskyon/taskyon/tools/authTools'
import {
  createDefaultTaskyonToolSetup,
  resolveInitialAgentToolCatalog,
  searchAgentToolCatalog,
} from '@taskyon/taskyon/tools'
import {
  createDocumentationIndexClientTool,
  createProtocolDocumentationBaseStore,
} from '@taskyon/taskyon/tools/documentationProviderTool'
import { taskyonDocumentationTool } from '@taskyon/taskyon/tools/documentationTool'
import { taskyonDocumentationManifest } from '@taskyon/taskyon/documentationManifest'
import {
  clearBrowserDesignGraphGitRepositories,
  createTaskyonBrowserCoreRuntime,
} from '@taskyon/runtime-browser'
import {
  createOpfsBlobStorageBackend,
  createOpfsStorageBackendResolver,
} from '@taskyon/runtime-browser/storage'
import { createStorageDagBackend } from '@taskyon/comp-dag/storageDagBackend'
import { useConversationHistory } from '@taskyon/ui/modules/useConversationHistory'
import { createTaskyonClient, taskyonGuiProtocol, taskyonProtocol } from '@taskyon/tyclient'
import type { TaskyonGuiMessage } from '@taskyon/tyclient'
import { createStandardEntryNodeTool } from '@taskyon/taskyon/tools/entryNode'
import { createTaskyonResourceFilesLoader } from 'src/modules/taskyonResourceFiles'
import { isBrowserRecordNamespace } from 'src/modules/taskyonStorageNamespaces'
import { until } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { defineStore } from 'pinia'
import { Dialog, useQuasar } from 'quasar' // load dynamically! :)
import { isTauri } from '@tauri-apps/api/core'
import { freeKey } from 'src/assets/taskyon_free_key'
import { setColors } from 'src/boot/brand-colors'
import { useGdrive } from 'src/modules/gdrive'
import { setPrismTheme } from '@taskyon/common/modules/markdownUtils '
import {
  initCryptoSessionFromBrowser,
  persistSession,
} from 'src/modules/taskyon/browserCryptoSession'
import { gDriveSyncPort } from 'src/modules/taskyon/sync'
import { type TyProfile } from 'src/modules/taskyon/types'
import { asyncComputed } from 'src/modules/vueUtils'
import { match, P } from 'ts-pattern'
import { computed, onScopeDispose, onWatcherCleanup, readonly, ref, watch, watchEffect } from 'vue'
import { guiTools } from '../modules/taskyon/GuiTools'
import {
  taskyonProfileSections,
  useAppStateStore,
  type EffectiveTaskyonCredential,
  type TaskyonProfileSettingsInput,
} from './appState'
import { waitForIframeDuplexChannel } from './iframeClient'
import { createDesignProjectStorage } from './designProjectStorage'
import z from 'zod'

/**
 * Creates a proxy for an asynchronous object initializer, allowing you to call methods
 * on the target object before it has been fully initialized. The methods are invoked
 * once the initialization is complete.
 *
 * @template T - A record type where each key maps to a function.
 * @param initializer - A function that returns a promise resolving to the target object.
 * @returns A proxy object that wraps the target object, enabling asynchronous method calls.
 *
 * @throws {Error} If a method is accessed that does not exist on the target object.
 *
 * @example
 * ```typescript
 * interface MyApi {
 *   fetchData(id: number): Promise<string>;
 *   saveData(data: string): Promise<void>;
 * }
 *
 * const apiProxy = asyncProxy<MyApi>(async () => {
 *   const api = await initializeApi(); // Assume this initializes the API object
 *   return api;
 * });
 *
 * // Usage
 * apiProxy.fetchData(1).then((data) => console.log(data));
 * apiProxy.saveData("example").then(() => console.log("Saved!"));
 * ```
 */
// Helper: Await if value is a Promise, else return as-is
function maybeAwait<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value)
}

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export function asyncProxy<T extends object>(initializer: () => Promise<T>): Asyncify<T> {
  const instancePromise = initializer()

  return new Proxy(
    {},
    {
      get(_, prop: string | symbol) {
        // Return a function if the property is a function on the target
        return (...args: unknown[]) =>
          instancePromise.then((instance) => {
            const value = instance[prop as keyof T]
            if (typeof value === 'function') {
              const result = value.apply(instance, args)
              // Await if it's a promise, else just return
              return maybeAwait(result)
            } else {
              // Non-function property: just return it
              return value
            }
          })
      },
    },
  ) as Asyncify<T>
}

async function updateLlmModels(
  provider: Parameters<typeof fetchModelsForProvider>[0],
  getApiKey: (name: string) => Promise<string | null>,
) {
  console.log('downloading models...')
  return await fetchModelsForProvider(provider, getApiKey, {
    useTokenServiceForOpenrouter: true,
    useTokenServiceForTaskyon: true,
  })
}

function connectWorkerStream(taskyon: Promise<Taskyon>) {
  const taskWorkerWaiting = ref(true)
  const workerStreamLogs = ref<(TyTaskStreamData & { timestamp: Date })[]>([])
  const maxLogRows = 50
  const lastActiveTaskId = ref<string | null>(null)
  const lastTaskState = ref(new Map<string, TyTaskStreamData['stage']>())
  const activeTaskIds = ref(new Set<string>())
  const taskFinishedStages = new Set<TyTaskStreamData['stage']>([
    'processed',
    'finished',
    'error',
    'aborted',
  ])
  const taskActiveStages = new Set<TyTaskStreamData['stage']>([
    'processing',
    'in loop',
    'subtasks',
    'tool progress',
  ])

  void taskyon.then(({ workerStream }) => {
    void workerStream((data) => {
      if (data.stage === 'all processed') taskWorkerWaiting.value = true
      else if (data.stage === 'processing') taskWorkerWaiting.value = false
    })

    void workerStream((data) => {
      console.log(`worker: ${data.stage}, ${data.taskId || data.task?.id}`)
      if (
        [
          'all processed',
          'processing',
          'processed',
          'finished',
          'error',
          'aborted',
          'tool progress',
        ].includes(data.stage)
      ) {
        workerStreamLogs.value.push({ ...data, timestamp: new Date() })
        // Ensure the log doesn't exceed the maximum number of rows
        if (workerStreamLogs.value.length > maxLogRows) {
          workerStreamLogs.value.shift() // Remove the oldest entry
        }
      }
    })

    void workerStream((data) => {
      const id = data.task?.id || data.taskId
      if (data.stage === 'all processed' || (data.stage === 'aborted' && !id)) {
        // "all processed" and global abort do not carry a task id, so clear stale in-progress states.
        lastTaskState.value.clear()
        activeTaskIds.value.clear()
        return
      }

      if (!id) return

      if (taskFinishedStages.has(data.stage)) {
        // we don't need the task anymore once we're done processing with it :)
        lastTaskState.value.delete(id)
        activeTaskIds.value.delete(id)
      } else if (taskActiveStages.has(data.stage)) {
        activeTaskIds.value.add(id)
        lastTaskState.value.set(id, data.stage)
      } else {
        lastTaskState.value.set(id, data.stage)
      }
    })

    workerStream.filter(
      (data) =>
        data.stage === 'processing' ||
        data.stage === 'tool progress' ||
        data.stage === 'processed' ||
        data.stage === 'finished' ||
        data.stage === 'error' ||
        (data.stage === 'aborted' && !!(data.taskId || data.task?.id)),
    )((data) => {
      // TODO: add last task to GUI by checking if our current selected task now has this child...
      lastActiveTaskId.value = data.task?.id || data.taskId || null
    })
  })

  return {
    taskWorkerWaiting: readonly(taskWorkerWaiting),
    lastActiveTaskId: readonly(lastActiveTaskId),
    workerStreamLogs: readonly(workerStreamLogs),
    activeTaskIds: readonly(activeTaskIds),
    lastTaskState: readonly(lastTaskState),
  }
}

function dynamicQuasarTheming(stateRefs: ReturnType<typeof useAppStateStore>) {
  const $q = useQuasar()
  watch(
    () => $q.dark.isActive,
    (newState) => setPrismTheme(newState),
  )

  watch(
    [
      () => stateRefs.appConfiguration.primaryColor,
      () => stateRefs.appConfiguration.secondaryColor,
    ],
    ([primary, secondary]) => {
      console.log('[THEME] state watcher triggered', {
        primary,
        secondary,
      })
      setColors(primary, secondary)
    },
    { immediate: true },
  )
}

const ChatSuggestions = [
  {
    url: '/chat/docs/conversations/features_intro',
    label: 'Showcase Taskyons features',
  },
  {
    url: '/chat/tyClientExamples/simpleExampleTutorial',
    label: 'How do I integrate taskyon into my own webpage?',
  },
  {
    md: `
<!--taskyon
name: Currently recommended models
role: "user"
label: ["discard"]
-->

Which models do you currently recommend?

---
<!--taskyon
name: Currently recommended models
role: "assistant"
label: ["discard"]
-->

Some AI models to get you started with:

  - meta-llama/llama-3.2-90b-vision-instruct: much cheaper than GPT4o and best for most tasks (including coding) and if you want to use "tools"
  - openai/gpt-4o: visual tasks and if you need to work in languages other than english
  - meta-llama/llama-3.2-11b-vision-instruct:  a very good "free" model
  - checkout the entire list of models and descriptions [here](https://taskyon.space/pricing)!

You can select them in the "Chat Settings" section in the message input window.
`,
    label: 'Show currently recommend models',
  },
]

function connectGdriveSync(
  directory: string,
  tyPort: Port<TaskyonGuiMessage, TaskyonGuiMessage>,
  getGdriveToken: () => Promise<string>,
) {
  const gdriveErrors = ref<unknown[]>([])
  const gds = gDriveSyncPort(directory + '/taskyon_sync', getGdriveToken, (error) => {
    console.error('gdrive error:', error)
    gdriveErrors.value.push(error)
  })
  //gds.connect(TY.port)
  //gds.receive(tyPort.send)

  const { port: subset } = createTypeFilteredPort(tyPort, [
    'taskCreated',
    'archive.importTaskRequest',
    'archive.importTaskResponse',
    'archive.requestTaskRequest',
    'archive.requestTaskResponse',
  ] as const)

  const portDisconnect = ref<(() => void) | false>(false)

  async function attemptConnect() {
    if (portDisconnect.value) throw new Error('Port is already connected...')
    console.log('connect gdrive!')
    // test if we can get a token
    // make sure, we get a gdrive token! before trying to connect!
    await getGdriveToken()
    portDisconnect.value = gds.connect(subset)
  }

  function disconnect() {
    if (!portDisconnect.value) {
      console.log('port is already disconnected')
      return
    }
    console.log('disconnect drive!')
    portDisconnect.value()
    portDisconnect.value = false
  }

  const gd = useGdrive(getGdriveToken)
  const keyDir = 'taskyon/provision'
  const uploadWrappedSessionKey = async (key: string, id: string) => {
    return await gd.uploadFileArchiveWMeta(keyDir, new File([key], id, { type: 'text/plain' }), [
      id,
    ])
  }

  const downloadWrappedSessionKey = async (id: string) => {
    console.warn('key is currently not deleted!!')
    const keyFile = await gd.downloadArchiveFile(keyDir, id, true)
    // TODO: also delete the directory!
    if (!keyFile) throw new Error("Key does't exist!")

    const key = await keyFile.text()
    return key
  }

  const clearAllKeys = () => gd.deleteDirectoryRecursive(keyDir)

  return {
    gdriveConnected: computed(() => !!portDisconnect.value),
    gdriveErrors: readonly(gdriveErrors),
    attemptConnect,
    disconnect,
    uploadWrappedSessionKey,
    downloadWrappedSessionKey,
    clearAllKeys,
  }
}

function defineTyGuiTools(
  stateRefs: ReturnType<typeof useAppStateStore>,
  ty: Taskyon,
  taskyonClient: ReturnType<typeof createTaskyonClient>,
  documentationBases: ReturnType<typeof createProtocolDocumentationBaseStore>,
): InternalTool[] {
  const taskyonProfileSectionSchema = z.enum(taskyonProfileSections)
  const profilePatchSchema = z
    .object({
      appConfiguration: z.record(z.string(), z.unknown()).optional(),
      llmSettings: z.record(z.string(), z.unknown()).optional(),
      toolchainProfiles: z.record(z.string(), z.unknown()).optional(),
      selectedToolchainProfile: z.string().nullable().optional(),
    })
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, {
      message: 'Provide at least one profile section to patch.',
    })
  const manageTaskyonProfileArgs = z.discriminatedUnion('action', [
    z.object({
      action: z.literal('readProfile'),
      sections: z.array(taskyonProfileSectionSchema).optional(),
    }),
    z.object({
      action: z.literal('patchProfile'),
      patch: profilePatchSchema,
      persist: z.boolean().optional(),
    }),
    z.object({
      action: z.literal('resetSections'),
      sections: z.array(taskyonProfileSectionSchema).optional(),
      persist: z.boolean().optional(),
    }),
    z.object({
      action: z.literal('readTaskChain'),
    }),
  ])
  const toProfileSettingsInput = (
    patch: z.infer<typeof profilePatchSchema>,
  ): TaskyonProfileSettingsInput => {
    const next: TaskyonProfileSettingsInput = {}
    if (patch.appConfiguration !== undefined) next.appConfiguration = patch.appConfiguration
    if (patch.llmSettings !== undefined) next.llmSettings = patch.llmSettings
    if (patch.toolchainProfiles !== undefined) next.toolchainProfiles = patch.toolchainProfiles
    if (patch.selectedToolchainProfile !== undefined) {
      next.selectedToolchainProfile = patch.selectedToolchainProfile
    }
    return next
  }

  return [
    ...guiTools,
    createOAuthTool(ty.setSecret),
    createDocumentationIndexClientTool(documentationBases),
    taskyonDocumentationTool,
    createClientTool({
      function: async (rawArgs, ctx) => {
        const args = manageTaskyonProfileArgs.parse(rawArgs)
        if (args.action === 'readProfile') {
          return stateRefs.getProfileSnapshot(args.sections)
        }
        if (args.action === 'patchProfile') {
          return {
            ok: true,
            action: args.action,
            persist: args.persist ?? false,
            ...stateRefs.patchProfileSettings(toProfileSettingsInput(args.patch), {
              persist: args.persist ?? false,
            }),
          }
        }
        if (args.action === 'resetSections') {
          return {
            ok: true,
            action: args.action,
            persist: args.persist ?? false,
            ...stateRefs.resetProfileSections(args.sections, { persist: args.persist ?? false }),
          }
        }
        return {
          action: args.action,
          taskChain: await ctx.getExecutionTaskChain(),
        }
      },
      description: 'Read, patch, or reset the active Taskyon profile settings.',
      longDescription:
        'Profile changes apply through the same validated browser store used by the settings UI and may optionally be persisted. Resets restore bundled defaults. The capability can also expose the current execution task chain, but never reads or mutates secrets or signature material.',
      name: 'manageTaskyonProfile',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['readProfile', 'patchProfile', 'resetSections', 'readTaskChain'],
            description: 'Profile management operation to perform.',
          },
          sections: {
            type: 'array',
            description:
              'Profile sections to read or reset. Defaults to all editable profile sections.',
            items: {
              type: 'string',
              enum: [...taskyonProfileSections],
            },
          },
          patch: {
            type: 'object',
            description:
              'Section-level patch for appConfiguration, llmSettings, toolchainProfiles, and/or selectedToolchainProfile.',
            properties: {
              appConfiguration: {
                type: 'object',
                description: 'Partial app configuration patch.',
                additionalProperties: true,
              },
              llmSettings: {
                type: 'object',
                description: 'Partial LLM settings patch.',
                additionalProperties: true,
              },
              toolchainProfiles: {
                type: 'object',
                description:
                  'Partial toolchain profiles patch. For base prompt templates, patch toolchainProfiles.base.entryNode.prompt_templates.',
                additionalProperties: true,
              },
              selectedToolchainProfile: {
                type: ['string', 'null'],
                description:
                  'Named toolchain profile to apply over base, or null to use base alone.',
              },
            },
            additionalProperties: false,
          },
          persist: {
            type: 'boolean',
            description:
              'Persist mutation to the active local profile. Defaults to false for transient changes.',
            default: false,
          },
        },
        required: ['action'],
        additionalProperties: false,
      } as const satisfies JSONSchema7,
    }),
  ]
}

const getBrowserUnavailableToolNames = () =>
  new Set(
    isTauri()
      ? []
      : ['tauriBashTool', 'tauriExploreWorkspace', 'tauriHttpWebReader', 'tauriPatchWorkspace'],
  )

function createTrustedUiToolContext(
  ty: Taskyon,
  taskyonClient: TaskyonClient,
): ToolRpcCreateContext {
  return async (call, stopSignal) => {
    const resolved = await taskyonClient.tools.resolve({
      name: call.functionName,
      ...(call.toolRevision ? { revision: call.toolRevision } : {}),
    })
    if (!resolved) throw new Error(`Registered UI tool not found: ${call.functionName}`)
    const toolSecretId = await generateSecretId(resolved.identity.revision, resolved.tool)
    const taskChain = call.taskId ? await taskyonClient.task.getChain({ id: call.taskId }) : []
    const caller = findCallingToolReference(taskChain, call.functionName)
    const resolvedCaller = caller ? await taskyonClient.tools.resolve(caller) : null
    const capabilityOwner = resolvedCaller?.identity ?? resolved.identity
    return {
      getExecutionTaskChain: () => {
        if (!call.taskId) {
          throw new Error(
            'getExecutionTaskChain is not available for this UI tool call because no task id was provided.',
          )
        }
        return taskyonClient.task.getChain({ id: call.taskId })
      },
      getCallingToolId: async () =>
        resolvedCaller
          ? await generateSecretId(resolvedCaller.identity.revision, resolvedCaller.tool)
          : null,
      createSubtasksResult,
      getSecret: async (name, askNew, saveNew = true) =>
        (await ty.getSecret(toolSecretId, name, askNew, saveNew)) ?? null,
      setSecret: async (name, value) => {
        await ty.setSecret(toolSecretId, name, value)
      },
      stopSignal,
      toolId: toolSecretId,
      requestPopup: ({ target }) => authorizeBrowserPopup({ tool: capabilityOwner, target }),
    }
  }
}

let browserCapabilityPolicy: ReturnType<typeof createCapabilityPolicy> | null = null

function getBrowserCapabilityPolicy() {
  browserCapabilityPolicy ??= createCapabilityPolicy({
    storage: {
      get: (key) => {
        const decision = localStorage.getItem(key)
        return Promise.resolve(decision === 'allow' || decision === 'deny' ? decision : null)
      },
      set: (key, decision) => {
        localStorage.setItem(key, decision)
        return Promise.resolve()
      },
      delete: (key) => {
        localStorage.removeItem(key)
        return Promise.resolve()
      },
      clear: (prefix) => {
        const matchingKeys = Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ).filter((key): key is string => key?.startsWith(prefix) === true)
        for (const key of matchingKeys) localStorage.removeItem(key)
        return Promise.resolve()
      },
    },
    prompt: (request) => {
      const presentation =
        request.capability.action === 'fetch'
          ? {
              cardClass: 'taskyon-capability-dialog taskyon-capability-dialog--network-access',
              color: 'info' as const,
              title: '🌐 Network access request',
              message: `${request.tool.name} wants to ${request.capability.access} data from ${request.capability.origin}. This permission does not allow the tool to open a browser window.`,
              onceLabel: 'Allow this network access once',
              sessionLabel: 'Allow network access this session',
              permanentLabel: 'Always allow this network access',
              allowLabel: 'Allow network',
            }
          : {
              cardClass: 'taskyon-capability-dialog taskyon-capability-dialog--popup-access',
              color: 'secondary' as const,
              title: '↗ Popup window request',
              message: `${request.tool.name} wants to open ${request.capability.target.replace(/^origin:/, '')} in a separate browser window. This permission does not grant network access to sandboxed code.`,
              onceLabel: 'Allow this popup once',
              sessionLabel: 'Allow popups this session',
              permanentLabel: 'Always allow this popup',
              allowLabel: 'Open popup',
            }
      return new Promise((resolve) => {
        let settled = false
        const finish = (decision: 'allow' | 'deny', scope: CapabilityScope) => {
          if (settled) return
          settled = true
          resolve({ decision, scope })
        }
        Dialog.create({
          class: presentation.cardClass,
          color: presentation.color,
          title: presentation.title,
          message: presentation.message,
          options: {
            type: 'radio',
            model: 'once',
            items: [
              { label: presentation.onceLabel, value: 'once' },
              { label: presentation.sessionLabel, value: 'session' },
              { label: presentation.permanentLabel, value: 'permanent' },
            ],
          },
          ok: { label: presentation.allowLabel, color: presentation.color },
          cancel: { label: 'Deny', color: 'negative', flat: true },
        })
          .onOk((scope: CapabilityScope) => finish('allow', scope))
          .onDismiss(() => finish('deny', 'session'))
      })
    },
  })
  return browserCapabilityPolicy
}

const authorizeBrowserSandboxFetch = ({
  tool,
  capability,
}: {
  tool: ToolIdentity
  capability: { origin: string; access: 'read' | 'write' }
}) =>
  getBrowserCapabilityPolicy().authorize({ tool, capability: { action: 'fetch', ...capability } })

const authorizeBrowserPopup = ({
  tool,
  target,
}: {
  tool: ToolIdentity
  target: 'custom-html' | `origin:${string}`
}) => getBrowserCapabilityPolicy().authorize({ tool, capability: { action: 'popup', target } })

function resolveTaskyonKey(args: {
  iframeToken?: KeyString | undefined
  credential?: EffectiveTaskyonCredential | undefined
  storedKeyStr?: KeyString | undefined
}) {
  const { credential, iframeToken, storedKeyStr } = args
  console.log('found stored key:', storedKeyStr?.slice(-5))

  return (iframeToken ??
    credential?.value ??
    // only use stored key if it isn't a free key and if it is a taskyon key
    (storedKeyStr === freeKey
      ? undefined
      : isTaskyonKey(storedKeyStr, true)
        ? storedKeyStr
        : undefined) ??
    freeKey) as KeyString
}

export const AiProvideKeyStoreName = 'AiProviderKey'

const useApiManagement = (
  stateRefs: ReturnType<typeof useAppStateStore>,
  taskyon: Thunk<Promise<Taskyon>>,
) => {
  const llmModelsInternal = ref<Record<string, ModelCard>>({})
  // we need this in order to reactivly see if something changed..
  const availableKeys = ref<Record<string, string | undefined>>({})

  const getProviderApiKey = async (name: string): Promise<KeyString | null> => {
    const ty = await taskyon()
    return (await ty.getSecret(AiProvideKeyStoreName, name, false, false)) as KeyString | null
  }

  const providerProfiles = computed(() => getToolchainProviderProfiles(stateRefs.toolchainProfiles))
  const selectedProviderProfile = computed(() => {
    const selected = stateRefs.selectedToolchainProfile
    return selected ? providerProfiles.value[selected] : undefined
  })
  const selectedProviderId = computed(() => selectedProviderProfile.value?.provider)
  const getSelectedModel = () => selectedProviderProfile.value?.model

  const loadLatestModelList = latestOnly(async () => {
    console.log('Update model list!')
    const provider = selectedProviderProfile.value
    return provider
      ? await updateLlmModels(provider, (name) =>
          Promise.resolve((availableKeys.value[name] as KeyString | undefined) ?? null),
        )
      : {}
  })

  const updateModelList = async () => {
    const models = await loadLatestModelList()
    if (models) llmModelsInternal.value = models
  }

  // TODO: add apis to model history as well!
  const addModelToHistory = (model: string) => {
    stateRefs.modelHistory = [
      ...stateRefs.modelHistory.filter((entry) => entry !== model),
      model,
    ].slice(-5)
  }

  const updateModelAndApi = ({
    newName,
    newService,
  }: {
    newName: string
    newService?: string | null
  }) => {
    console.log('getting an api & bot update', {
      'new name': newName,
      'new service': newService,
      'old name': selectedProviderProfile.value?.model,
      'old service': stateRefs.selectedToolchainProfile,
    })

    if (newService) {
      stateRefs.setSelectedToolchainProfile(newService)
    }
    if (selectedProviderProfile.value) {
      console.log('update model for provider profile:', stateRefs.selectedToolchainProfile, newName)
      stateRefs.setActiveToolchainValue(['chatCompletion', 'model'], newName)
    }
    addModelToHistory(newName)
  }

  const taskyonKey = computed(() => {
    const provider = selectedProviderProfile.value?.provider
    if (provider === 'taskyon') {
      console.log('check if we are using a taskyon key!')
      // if we have a taskyon key defined only display the models allowed for that key..
      const key = isTaskyonKey(availableKeys.value.taskyon ?? undefined, false)
      return key
    }
    return undefined
  })

  const getTaskyonKeyString = () => {
    return availableKeys.value.taskyon
  }

  const currentKeyString = computed(() => {
    const provider = selectedProviderProfile.value?.provider
    if (provider) return availableKeys.value[provider] ?? null
    return null
  })

  const usingFreeTaskyonKey = computed(() => {
    const useFreeKey =
      selectedProviderProfile.value?.provider === 'taskyon' &&
      availableKeys.value['taskyon'] === freeKey
    console.log('using free key:', useFreeKey)
    return useFreeKey
  })

  function getKeyModels(key: tyPublicApiKeyObject) {
    if (key.model && key.model.length > 0 && !key.model.includes('*')) {
      console.log('update allowed models!', key.model)
      return key.model
    }
    return undefined
  }

  const tyKeyAllowedModels = computed(() => {
    const key = taskyonKey.value
    if (!key) return undefined
    return getKeyModels(key)
  })

  const setProviderApiKey = exclusive(
    async (name: string, value: KeyString | undefined, mode: 'persist' | 'runtime') => {
      console.log('set new provider key:', name, value?.slice(-5))
      const ty = await taskyon()
      if (mode === 'persist') {
        if (value) await ty.setSecret(AiProvideKeyStoreName, name, value)
        else await ty.deleteSecret(AiProvideKeyStoreName, name)
      }
      await ty.updateChatCompletionApiKey(name, value)
      // and keep track of it internally
      if (value) {
        availableKeys.value = { ...availableKeys.value, [name]: value }
      } else {
        availableKeys.value = Object.fromEntries(
          Object.entries(availableKeys.value).filter(([provider]) => provider !== name),
        )
      }
    },
  )

  ///////////   computed properties
  const providerDefs = computed(() => Object.keys(providerProfiles.value))
  const availableProviders = computed(() => {
    return Object.entries(providerProfiles.value)
      .filter(([, provider]) => Object.hasOwn(availableKeys.value, provider.provider))
      .map(([profileName]) => profileName)
  })

  // Computed property to determine the currently selected bot name
  const currentModelId = computed(getSelectedModel)

  const currentModel = computed(() => {
    return currentModelId.value ? llmModelsInternal.value[currentModelId.value] : null
  })

  const noAiService = computed(() => currentKeyString.value == null)

  function getValidModel(key: tyPublicApiKeyObject) {
    const cm = getSelectedModel()
    console.log('currently selected model', cm)
    const keyModels = getKeyModels(key)
    if (!keyModels) return
    if (cm && keyModels.includes(cm)) {
      console.log('currrent model is already in allowed list!', cm, tyKeyAllowedModels.value)
    } else if (cm) {
      console.log('currently selected model is not in allowed list', tyKeyAllowedModels.value, cm)
      return keyModels[0]
    }
  }

  const ensureValidModel = (keystr?: KeyString) => {
    if (selectedProviderProfile.value?.provider !== 'taskyon') {
      return
    }
    const tykey = isTaskyonKey(keystr ?? undefined, false)
    if (tykey) {
      const model = getValidModel(tykey)
      if (model) updateModelAndApi({ newName: model })
    }
  }

  const shouldUpdateFreeKey = (currentTyKey?: KeyString) => {
    // make sure, we update old free keys that are currently in use
    // whne a key is updated, taskyon identifies the old key as a
    // 'custom' key so we need to explicitly update it with the new key.
    if (currentTyKey && currentTyKey !== freeKey) {
      if (['W1lIjoidGFza3lvbi5zcGFjZTpmcmVlX2tleV8yMDI1MDgw'].some((n) => currentTyKey.includes(n)))
        return true
    }
  }

  //////   INITIALIZATION
  // make sure, that we check our secretStore right after initialization if we hae stored any keys in
  // there (especially ifits a taskyon key) and then use those!
  const initModelsAndStoredKeys = async () => {
    const ty = await taskyon()
    const sessionId = await ty.getCryptoSession().getSessionId()
    console.log(`Sync secretstore with taskyon keys!, ${sessionId}`, {
      effectiveTaskyonCredential: stateRefs.effectiveTaskyonCredential?.value.slice(-5),
      iframeApiKey: stateRefs.iframeApiKey,
    })

    const storedKeys = await ty.listSecrets(AiProvideKeyStoreName)
    let storedKeyStr = storedKeys.taskyon as KeyString | undefined
    if (shouldUpdateFreeKey(storedKeyStr)) storedKeyStr = freeKey as KeyString
    const selectedKey = resolveTaskyonKey({
      iframeToken: stateRefs.iframeApiKey,
      credential: stateRefs.effectiveTaskyonCredential,
      storedKeyStr,
    })
    console.log('setting selected key:', selectedKey?.slice(-5))
    if (selectedKey !== storedKeyStr) {
      await setProviderApiKey('taskyon', selectedKey, 'runtime')
    }
    availableKeys.value = { ...storedKeys, ...availableKeys.value, taskyon: selectedKey }
    ensureValidModel(selectedKey)
  }

  // make sure we update our model list whenever anything changes for our
  // endpoints...
  // Keep model discovery aligned with explicit provider-profile and secret changes.
  watch(
    [
      () => stateRefs.selectedToolchainProfile,
      () => stateRefs.effectiveTaskyonCredential,
      providerProfiles,
      availableKeys,
    ],
    async ([newSelectedProfile, taskyonCredential, newProfiles, availableKeys]) => {
      console.log('update models... due to api/key change', {
        newSelectedProfile,
        taskyonCredential: taskyonCredential?.value.slice(-5),
        newProfiles,
        availableKeys,
      })
      if (selectedProviderProfile.value?.provider === 'taskyon') {
        const storedKeyStr = availableKeys.taskyon as KeyString | undefined
        if (storedKeyStr || stateRefs.effectiveTaskyonCredential || stateRefs.iframeApiKey) {
          console.log('ensure, we have a valid model for taskyon key...')
          const selectedKey = resolveTaskyonKey({
            iframeToken: stateRefs.iframeApiKey,
            credential: stateRefs.effectiveTaskyonCredential,
            storedKeyStr,
          })
          if (selectedKey !== availableKeys.taskyon) {
            await setProviderApiKey('taskyon', selectedKey, 'runtime')
          }
          ensureValidModel(selectedKey)
        }
      }
      await updateModelList()
    },
    {
      immediate: true,
    },
  )

  return {
    initModelsAndStoredKeys,
    getTaskyonKeyString,
    currentModelId,
    tyKeyAllowedModels,
    taskyonKey,
    currentKeyString,
    currentModel,
    usingFreeTaskyonKey,
    availableProviders,
    providerDefs,
    providerProfiles,
    selectedProviderId,
    noAiService,
    setProviderApiKey,
    getProviderApiKey,
    // Method to handle the updateBotName event
    updateModelAndApi,
    llmModels: computed(() => llmModelsInternal.value),
  }
}

function taskUiUpdates(
  taskyon: Promise<Taskyon>,
  taskyonClient: TaskyonClient,
  stateRefs: ReturnType<typeof useAppStateStore>,
) {
  // we are using refs here for selectedThread and currentTask isntead of a computed reference, because
  // we want to oad them gradually into our UI
  const currentTask = ref<TaskNode | null>(null)
  const pendingCreatedTaskIds = ref(new Set<string>())
  const taskSelectionRevision = ref(0)
  const taskTreeRevision = ref(0)
  const followedTaskId = ref<string>()
  const pendingFollowTaskIds = new Set<string>()
  const currentTaskResolutionStatus = ref<'idle' | 'loading' | 'resolved' | 'missing'>('idle')
  const conversationHistory = useConversationHistory({
    history: computed({
      get: () => stateRefs.chatHistory,
      set: (history) => {
        stateRefs.chatHistory = history
      },
    }),
    getClient: () => taskyonClient.task,
    onError: (error) => console.warn('Could not update conversation history.', error),
  })

  function markTasksPendingCreation(taskIds: readonly string[]) {
    const nextPending = new Set(pendingCreatedTaskIds.value)
    for (const taskId of taskIds) {
      nextPending.add(taskId)
    }
    pendingCreatedTaskIds.value = nextPending
    taskSelectionRevision.value += 1
  }

  void taskyon.then((ty) => {
    ty.taskStream(({ id, data: task }) => {
      taskTreeRevision.value += 1
      if (!task) {
        void conversationHistory.remove(id.toString())
        return
      }
      if (pendingCreatedTaskIds.value.has(id.toString())) {
        const nextPending = new Set(pendingCreatedTaskIds.value)
        nextPending.delete(id.toString())
        pendingCreatedTaskIds.value = nextPending
        taskSelectionRevision.value += 1
      }
      const selectedTaskId = stateRefs.selectedTaskId
      const selectedOrPendingTaskId = followedTaskId.value ?? selectedTaskId
      if (
        selectedOrPendingTaskId &&
        selectedOrPendingTaskId !== id &&
        (task.parentID === selectedOrPendingTaskId || task.priorID === selectedOrPendingTaskId)
      ) {
        followedTaskId.value = id.toString()
        pendingFollowTaskIds.add(id.toString())
        stateRefs.navigateToTask(id.toString(), { replace: true })
      }
      if (currentTask.value?.id === id) {
        // console.log('update current task...', task)
        currentTask.value = task
      }
      if (selectedTaskId === id) {
        currentTask.value = task
        currentTaskResolutionStatus.value = 'resolved'
        taskSelectionRevision.value += 1
      }
    })

    // this needs to be a watch, because we're updating this variable from other sources as well...
    // TODO: make this a readonly property...
    watch(
      () =>
        [
          stateRefs.selectedTaskId,
          stateRefs.sessionId,
          stateRefs.taskyonSessionStatus,
          taskSelectionRevision.value,
        ] as const,
      async ([newSelectedTask, , sessionStatus]) => {
        let cancelled = false
        onWatcherCleanup(() => {
          cancelled = true
        })
        // TODO: I don't remember why we need this delay here....
        if (sessionStatus !== 'ready') {
          currentTask.value = null
          currentTaskResolutionStatus.value = newSelectedTask ? 'loading' : 'idle'
        } else if (newSelectedTask) {
          currentTaskResolutionStatus.value = 'loading'
          let task: TaskNode | null
          try {
            task = await taskyonClient.task.get({ id: newSelectedTask })
          } catch (error) {
            if (cancelled) return
            console.error(`Failed to resolve selected task ${newSelectedTask}`, error)
            task = null
          }
          if (cancelled) return
          currentTask.value = task
          currentTaskResolutionStatus.value = task
            ? 'resolved'
            : pendingCreatedTaskIds.value.has(newSelectedTask)
              ? 'loading'
              : 'missing'
        } else {
          currentTask.value = null
          currentTaskResolutionStatus.value = 'idle'
        }
      },
      {
        immediate: true,
      },
    )

    // also make sure, that we update the history with the currently selected chat when initializing...
    // TODO: this here is a porblem, because "currentTask" gets updated asynchrouously..
    watch(
      currentTask,
      (newValue) => {
        if (newValue) void conversationHistory.record(newValue)
      },
      { once: true },
    )

    // also update chat history if we switch between tasks...
    watch(
      () => [stateRefs.selectedTaskId, stateRefs.taskyonSessionStatus] as const,
      async ([selectedTask, sessionStatus]) => {
        if (selectedTask && pendingFollowTaskIds.has(selectedTask)) {
          if (selectedTask === followedTaskId.value) pendingFollowTaskIds.clear()
          else pendingFollowTaskIds.delete(selectedTask)
        } else {
          followedTaskId.value = selectedTask
          pendingFollowTaskIds.clear()
        }
        if (selectedTask && sessionStatus === 'ready') {
          const taskNode = await taskyonClient.task.get({ id: selectedTask })
          if (taskNode) void conversationHistory.record(taskNode)
        }
      },
      { immediate: true },
    )
  })

  const selectedThread = asyncComputed<TaskNode[]>(
    async () => {
      const newSelectedTask = stateRefs.selectedTaskId
      if (stateRefs.taskyonSessionStatus !== 'ready') {
        return []
      } else if (newSelectedTask) {
        const ty = await taskyon
        const selectedThreadIDs = await taskyonClient.task.getIdChain({ id: newSelectedTask })
        return await ty.convertTaskIDs(selectedThreadIDs)
      } else {
        return []
      }
    },
    [],
    () =>
      [
        stateRefs.selectedTaskId,
        stateRefs.sessionId,
        stateRefs.taskyonSessionStatus,
        taskSelectionRevision.value,
      ] as const,
  )

  return {
    selectedThread,
    taskTreeRevision: readonly(taskTreeRevision),
    currentTask: computed(() => currentTask),
    currentTaskResolutionStatus: computed(() => currentTaskResolutionStatus.value),
    markTasksPendingCreation,
    conversationHistory,
  }
}

type TaskyonClient = ReturnType<typeof createTaskyonClient>

function reactiveTools(taskyon: Promise<Taskyon>, taskyonClient: TaskyonClient) {
  const allTools = ref<Record<string, ToolBase>>({})

  void taskyon.then((ty) => {
    const loadLatestTools = latestOnly(() => taskyonClient.tools.list({ includeHidden: true }))
    const updateTools = async () => {
      const tools = await loadLatestTools()
      if (tools !== undefined) allTools.value = tools
    }
    void updateTools()

    // if a new "default" tool was created update UI
    // TODO: can we move this into our init.ts? or does it make sense here?
    ty.port.receive((msg) => {
      console.log('api out message!', msg)
      if (msg.type !== 'status' || msg.data.type !== 'newtool') return
      console.log('Default Tool definition was added to taskyon!', msg.data.id)
      void updateTools()
    })

    // if a new tool was created as a tasknode, update UI
    ty.taskStream(
      (msg) =>
        void match(msg)
          .returnType<void>()
          .with(
            {
              data: {
                content: {
                  type: 'tooldefinition',
                  data: {
                    id: P.select(),
                  },
                },
              },
            },
            (id) => {
              console.log('Tool definition was added to taskyon!', id)
              void updateTools()
            },
          ),
    )
  })
  return allTools
}

const useSwitchCryptoSession = (
  taskyon: Promise<Taskyon>,
  gdp: Promise<ReturnType<typeof connectGdriveSync>>,
  registerSessionTools: () => Promise<void>,
) => {
  // TODO: somehow use a better id here?  maybe we could use the id from our taskyon login?
  const shareKeyId = 'taskyonShareKeyID'
  // we use a fixed salt right now, because we never save the key ...
  const salt = new TextEncoder().encode('taskyonSalt')
  async function uploadSessionKey() {
    const ty = await taskyon
    const cs = ty.getCryptoSession()

    const sharingSecret = randomString()
    const sharingKey = await deriveKeyFromPwd(sharingSecret, salt, true)
    const sharedSK = await cs.exportSessionKey(sharingKey)

    const gd = await gdp
    await gd.uploadWrappedSessionKey(sharedSK, shareKeyId)
    return sharingSecret
  }

  async function newSessionFromGdrive(sharingSecret: string) {
    const gd = await gdp
    const key = await gd.downloadWrappedSessionKey(shareKeyId)
    // TODO: delete directory and file after downloading secret!!
    console.warn('we need to delete the directory and secret!!')
    const sharingKey = await deriveKeyFromPwd(sharingSecret, salt, true)
    const ty = await taskyon
    return await ty.getCryptoSession().derive({ wrappedSK: key, unwrapper: sharingKey })
  }

  async function getDeviceId() {
    const ty = await taskyon
    return await cryptoKeyToBase64(ty.getCryptoSession().getDevicePublicKey())
  }

  const setNewSession = async (cs: CryptoSession, persist = false) => {
    console.log('switching to new crypto session...', await cs.getSessionId())
    const ty = await taskyon
    await ty.setNewSession(cs)
    await registerSessionTools()
    if (persist) await persistSession(cs)
  }

  return {
    setNewSession,
    getDeviceId,
    newSessionFromGdrive,
    uploadSessionKey,
  }
}

export const useTaskyonStore = defineStore('taskyonControl', () => {
  console.log('loading taskyon store!')

  // load our store with all the settings
  // we use this here to confgure out taskyon logic
  const stateRefs = useAppStateStore()

  // we are doing this here so that we can provide new suggestions on every
  // page load
  stateRefs.appConfiguration.chatSuggestions = ChatSuggestions

  // callin ExecutionContext.interrupt();  cancels processing of current task
  console.log('initialize taskyon')

  const getEntryNodeToolName = (entryNodeDraft: partialTaskDraft): string => {
    if (entryNodeDraft.content.type !== 'functioncall') return 'entryNode'
    const data = entryNodeDraft.content.data
    if (!data || typeof data !== 'object' || !('name' in data) || typeof data.name !== 'string') {
      return 'entryNode'
    }
    return data.name
  }
  const buildEntryNodeDraft = () =>
    ({
      role: 'system',
      content: {
        type: 'functioncall',
        data: {
          name: stateRefs.llmSettings.entryFunction,
          arguments: {},
        },
      },
    }) as partialTaskDraft
  // this means previously, we have loaded a session with a binding key.
  // so we would like to wait a little bit, if we will get that same binding key...
  const initialCryptoSession = (async () => {
    if (stateRefs.initWBindingKey) {
      console.log('waiting for session binding key to be set...')
      const bindingKey = await until(() => stateRefs.bindingKey).toBeTruthy({ timeout: 5000 })
      console.log('got session binding key!', bindingKey)
      const initCs = initCryptoSessionFromBrowser(
        {
          bindingKey,
        },
        true,
      )
      return initCs
    } else {
      console.log('initializing session without binding key...')
      const initCs = initCryptoSessionFromBrowser(undefined, true)
      return initCs
    }
  })()
  const opfsStorageBackend = createOpfsStorageBackendResolver()
  const runtime = createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({
      ...stateRefs.llmSettings,
      entryNode: buildEntryNodeDraft(),
    }),
    entryNode: buildEntryNodeDraft,
    toolchainConfig: stateRefs.effectiveToolchainConfig,
    taskSearchVectorizer: stateRefs.appConfiguration.taskSearchVectorizer,
    cryptoSession: initialCryptoSession,
    toolSetup: (storageClient) =>
      createDefaultTaskyonToolSetup({
        unavailableToolNames: getBrowserUnavailableToolNames(),
        storageClient,
      }),
    authorizeSandboxFetch: authorizeBrowserSandboxFetch,
    authorizePopup: authorizeBrowserPopup,
    storage: {
      kind: 'service',
      createService: (port) =>
        createPgLiteTaskManagerStorageService(
          port,
          getDatabase,
          (namespace) => {
            if (!isBrowserRecordNamespace(namespace)) {
              throw new Error(
                `No browser storage backend is configured for namespace "${namespace}".`,
              )
            }
            return opfsStorageBackend(namespace)
          },
          async (namespace) => await createOpfsBlobStorageBackend(namespace),
        ),
    },
  })
  onScopeDispose(() => {
    void runtime.stop('disposing Taskyon UI runtime')
  })
  const taskyon = runtime.taskyon
  const taskyonClient = runtime.client
  const taskyonRuntimeClient = taskyon.then((ty) =>
    createPortClient(ty.hostPort, taskyonRuntimeProtocol),
  )
  watch(
    () => stateRefs.effectiveToolchainConfig,
    async (toolchainConfig) => {
      const result = await (await taskyonRuntimeClient).runtime.configure({ toolchainConfig })
      if (!result.ok) throw new Error(`Could not configure Taskyon runtime: ${result.error}`)
    },
    { deep: true },
  )
  const storageClient = runtime.storageClient
  const templateCacheNamespace = 'taskyon/local/task-template-render/v1'
  const taskTemplateRenderer = createTaskTemplateRenderer({
    getTaskById: async (taskId) => await taskyonClient.task.get({ id: taskId }),
    cache: createPersistentTaskTemplateCache({
      storage: {
        get: async (id) => {
          const value = (await storageClient.get({ namespace: templateCacheNamespace, id })).value
          if (!value || typeof value !== 'object') return null
          const accessedAt = Reflect.get(value, 'accessedAt')
          const cachedValue = Reflect.get(value, 'value')
          return typeof accessedAt === 'number' && typeof cachedValue === 'string'
            ? { accessedAt, value: cachedValue }
            : null
        },
        set: async (id, value) => {
          await storageClient.set({ namespace: templateCacheNamespace, id, value })
        },
        delete: async (id) => {
          await storageClient.delete({ namespace: templateCacheNamespace, id })
        },
        list: async () =>
          (await storageClient.list({ namespace: templateCacheNamespace })).rows.flatMap((row) => {
            const value = row.data
            if (!value || typeof value !== 'object') return []
            const accessedAt = Reflect.get(value, 'accessedAt')
            const cachedValue = Reflect.get(value, 'value')
            return typeof accessedAt === 'number' && typeof cachedValue === 'string'
              ? [{ id: row.id, data: { accessedAt, value: cachedValue } }]
              : []
          }),
      },
    }),
  })
  const resetTaskyonLocalStorageState = async () => {
    await Promise.all([
      ...['taskyon/ui-state/v1', 'ui/split-layouts/v1', 'documentation/manifests'].map(
        async (namespace) => await storageClient.clear({ namespace }),
      ),
      clearBrowserDesignGraphGitRepositories(),
    ])
  }
  const dagStorageBackend = createStorageDagBackend({
    get: async (namespace, id) => (await storageClient.get({ namespace, id })).value,
    set: async (namespace, id, value) => {
      await storageClient.set({ namespace, id, value })
    },
  })
  const { designProjectStore, registerDesignProject, listDesignProjects } =
    createDesignProjectStorage(storageClient)
  const resourceFilesLoader = createTaskyonResourceFilesLoader(
    () => taskyonClient.discovery.describe({}),
    storageClient,
  )
  const documentationBases = createProtocolDocumentationBaseStore(
    storageClient,
    resourceFilesLoader,
  )
  const documentationReady = documentationBases.register(taskyonDocumentationManifest, 'taskyon')
  const allTools = reactiveTools(taskyon, taskyonClient)

  const entryNodeTool = createStandardEntryNodeTool({
    name: getEntryNodeToolName(buildEntryNodeDraft()),
    renderOptions: { hideChat: true, hideLlm: true },
    toolChooser: { enabled: true, useTools: true },
    getToolCatalog: async ({ taskChain, allowedTools }) => {
      const currentTools: Record<string, ToolBase> = await taskyonClient.tools.list({
        includeHidden: true,
      })
      return resolveInitialAgentToolCatalog(
        currentTools,
        taskChain,
        getBrowserUnavailableToolNames(),
        allowedTools,
      )
    },
    searchToolCatalog: async (query, limit) => {
      const currentTools: Record<string, ToolBase> = await taskyonClient.tools.list({
        includeHidden: true,
      })
      return searchAgentToolCatalog(currentTools, query, limit, getBrowserUnavailableToolNames())
    },
  })

  const uiToolRpcHost = taskyon.then(async (ty) => {
    const host = await registerToolRpcTools({
      port: ty.port,
      tools: () => [
        entryNodeTool,
        ...defineTyGuiTools(stateRefs, ty, taskyonClient, documentationBases),
      ],
      createContext: createTrustedUiToolContext(ty, taskyonClient),
    })
    await taskyonClient.tools.list({})
    return host
  })
  onScopeDispose(() => {
    void uiToolRpcHost.then((host) => host.destroy())
  })
  const registerUiToolsForCurrentSession = async () => {
    await (await uiToolRpcHost).register()
  }

  const apiKeyManagement = useApiManagement(stateRefs, () => taskyon)
  stateRefs.setTaskyonAuthLoading(true)
  void apiKeyManagement
    .initModelsAndStoredKeys()
    .finally(() => stateRefs.setTaskyonAuthLoading(false))

  const switchTaskyonSessionForBindingKey = async (bindingKey: CryptoKey | null) => {
    console.log('new binding key', bindingKey)
    stateRefs.setTaskyonSessionSwitching(true)
    try {
      const cs = await initCryptoSessionFromBrowser(
        {
          bindingKey: bindingKey ?? undefined,
        },
        true,
      )
      const ty = await taskyon
      const newId = await cs.getSessionId()
      const oldId = await ty.getCryptoSession().getSessionId()

      if (newId === oldId) return
      console.log(`switch user session because of binding key change! ${oldId}->${newId}`)
      await uiToolRpcHost
      await ty.setNewSession(cs)
      await registerUiToolsForCurrentSession()
      stateRefs.setSessionId(newId)
      await apiKeyManagement.initModelsAndStoredKeys()
    } finally {
      stateRefs.setTaskyonSessionSwitching(false)
    }
  }
  const unregisterTaskyonSessionTransition = stateRefs.registerTaskyonSessionTransition(
    switchTaskyonSessionForBindingKey,
  )
  onScopeDispose(unregisterTaskyonSessionTransition)

  const {
    conversationHistory,
    currentTask,
    currentTaskResolutionStatus,
    markTasksPendingCreation,
    selectedThread,
    taskTreeRevision,
  } = taskUiUpdates(taskyon, taskyonClient, stateRefs)

  // iApiOutside is the port to the "outside" of taskyon UI. It is the port used to
  // communicate towards the taskyon engine. iApiInside communicates to the outside of taskyon.
  // For example the iframe is connected to iApiOutside because
  // it lives outside the taskyon logic. iApiInside is used by our internal
  // services e.g. the engine to communicate to the outside.
  const { x: uiApiOutside, y: uiApiInside } = createProtocolPort(taskyonGuiProtocol)
  const uiTaskyonClient = createTaskyonClient(uiApiOutside, { taskCacheSize: 0 })

  void taskyon.then(async (ty) => {
    //const taskStream = tyInit.taskManagerInstance.taskStream
    //syncToGdrive(taskStream, stateRefs.appConfiguration.gdriveDir)

    // add an API for taskyon GUI and make sure "unused" messages are routed through to the
    // taskyon engine!
    // TODO: red-define this as a middleware where we can intercept certain messages
    //       and also change the types of inside/outside ports...
    uiApiInside.receive((msg) => console.log('received message on UI port!', msg))
    createPortServer(
      uiApiInside,
      taskyonGuiProtocol,
      {
        configureTaskyon: async (msg) => {
          const newConfig = msg.conf
          let sessionBindingKey: CryptoKey | null | undefined
          const appCfg = newConfig.appConfiguration as
            | Partial<TyProfile['appConfiguration']>
            | undefined
          if (typeof msg.profileName === 'string' && msg.profileName.trim()) {
            stateRefs.setActiveProfile(msg.profileName)
          }
          const explicitNoBindingKey = msg.missingBindingKeyPolicy === 'noBindingKey'
          if (explicitNoBindingKey) {
            stateRefs.setBindingKey(null, 'unknown')
            sessionBindingKey = null
          }
          if (msg.bindingKey !== undefined && msg.bindingKey !== null) {
            if (msg.bindingKey instanceof CryptoKey) {
              stateRefs.setBindingKey(msg.bindingKey, 'unknown')
              sessionBindingKey = msg.bindingKey
            } else if (typeof msg.bindingKey === 'string' && msg.bindingKey.trim()) {
              try {
                const importedBindingKey = await base64ToPublixX25519(msg.bindingKey, false)
                stateRefs.setBindingKey(importedBindingKey, 'unknown')
                sessionBindingKey = importedBindingKey
              } catch (error) {
                console.warn('[IFRAME CONFIG] failed to import binding key from host', error)
              }
            } else {
              console.warn('[IFRAME CONFIG] unsupported binding key payload received')
            }
          }
          console.log('[IFRAME CONFIG] setting configuration', {
            persist: !!msg.persist,
            peerId: msg.peerId,
            origin: msg.origin,
            profileName: msg.profileName,
            hasBindingKey: !!msg.bindingKey,
            missingBindingKeyPolicy: msg.missingBindingKeyPolicy,
            hasLlmSettings: !!newConfig.llmSettings,
            hasAppConfiguration: !!newConfig.appConfiguration,
            hasToolchainProfiles: !!newConfig.toolchainProfiles,
            selectedToolchainProfile: newConfig.selectedToolchainProfile,
            hasSignatureOrKey: !!newConfig.signatureOrKey,
            incomingPrimaryColor: appCfg?.primaryColor,
            incomingSecondaryColor: appCfg?.secondaryColor,
          })
          stateRefs.overRideSettings(newConfig, !!msg.persist)
          if (sessionBindingKey !== undefined) {
            await switchTaskyonSessionForBindingKey(sessionBindingKey)
          }
          console.log('[IFRAME CONFIG] effective colors after merge', {
            primaryColor: stateRefs.appConfiguration.primaryColor,
            secondaryColor: stateRefs.appConfiguration.secondaryColor,
          })
          // let taskyon do more configurations

          // and also set a possible signature as the api key!
          if (newConfig.signatureOrKey) {
            // we only set the API key, if it was provided by the
            // parent app.
            const newKey = newConfig.signatureOrKey as KeyString
            if (typeof newKey === 'string') {
              stateRefs.iframeApiKey = newKey
              await apiKeyManagement.initModelsAndStoredKeys()
            } else {
              console.warn('Provided signatureOrKey is not a string:', newKey)
            }
          }

          // TODO:  set taskyon-relevant settings in the "backend"
          //tyInit.outPort.send(msg)
        },
        pasteClipboard: (msg) => {
          const pastedText = msg.text ?? msg.html ?? ''
          if (pastedText) {
            stateRefs.createTaskType = { type: 'message' }
            stateRefs.messageDraft = `${stateRefs.messageDraft ?? ''}${pastedText}`
          }

          if (msg.files?.length) {
            const pastedFiles = msg.files.map(
              (file) =>
                new File([decodeBase64ToArrayBuffer(file.data)], file.name, { type: file.type }),
            )
            stateRefs.queueDraftPasteFiles(pastedFiles)
          }
        },
      },
      {
        onError: (error) =>
          console.error('an error occured during handling of the GUI protocol command', error),
      },
    )

    uiApiInside.receive((msg) => {
      if (msg.type === 'configureTaskyonRequest' || msg.type === 'pasteClipboardRequest') return
      if (msg.type === 'task.createRequest') {
        void ensureValidTaskId(msg.task)
          .then(() => ty.port.send(msg))
          .catch((error) => {
            console.error('an error occured during handling of the createTask command', error)
          })
        return
      }
      if (msg.type === 'task.createChainRequest') {
        void Promise.all(msg.tasks.map((task) => ensureValidTaskId(task)))
          .then((tasks) => {
            const taskIds = tasks.map((task) => task.id)
            markTasksPendingCreation(taskIds)
            if (msg.show) stateRefs.navigateToTask(taskIds.at(-1), { replace: true })
            ty.port.send({ ...msg, tasks })
          })
          .catch((error) => {
            console.error('an error occured during handling of the createTaskChain command', error)
          })
        return
      }
      const parsed = taskyonProtocol.message.safeParse(msg)
      if (parsed.success) ty.port.send(parsed.data as TaskyonMessageType)
      else console.log('unknown message:', msg)
    })
    // we manually connect our send port to the api here, because
    // we are already intercepting incoming messages with the API above
    // TODO: we have to change this! we would like to
    ty.port.receive(uiApiInside.send)
    uiApiInside.send({ type: 'taskyonReady' })

    console.log('checking if we are in an iframe!')

    /// -------   IFRAME operations --------
    // We load the iframe here with the iframe=true parameter to make embedded e2e tests work.
    // set up iframe API and hook it up to our taskyon api
    //if ($q.platform.within.iframe) {
    if (stateRefs.isInIframe) {
      console.log('taskon is in iframe!, waiting for message port!')
      stateRefs.taskyonRunmode = 'waiting for connection'
      const iframePort = await waitForIframeDuplexChannel()
      // connect iframe API to internal GUI API which also connects to taskyon engine automatically.
      iframePort.connect(uiApiOutside)
      iframePort.send({ type: 'taskyonReady' })
      console.log('taskyon connected to iframe!')
      stateRefs.taskyonRunmode = 'connected'
    }
    // ------------end of IFRAME operations-------
  })

  // an oauth token getter function which persists secrets in our local secretstore!
  const getToken: TokenGetter = async (...args) => {
    const ty = await taskyon
    const tg = createPersistentOauthTokenGetter({
      getSecret: async (name) => await ty.getSecret(OAUTH_CREDENTIALS_SECRET_PREFIX, name, false),
      setSecret: async (name, data) =>
        await ty.setSecret(OAUTH_CREDENTIALS_SECRET_PREFIX, name, data as KeyString),
    })
    return await tg(...args)
  }

  const gdriveConnected = ref(false)
  const gdriveErrors = ref<unknown[]>([])

  async function getGdriveToken(options?: AuthenticationOptions) {
    const creds = await getToken(
      'google',
      {
        oauthURL: OAUTH_PROVIDERS.google.authUrl,
        clientId: OAUTH_PROVIDERS.google.clientId,
        scope: OAUTH_PROVIDERS.google.scope,
      },
      undefined,
      options,
    )
    return creds.access_token
  }

  const gdp = taskyon.then((ty) => {
    // in GUI applications we can connect gdrive for synchronization purposes!
    // we don't need any password or anything here, because
    // gdrive receives already encrypted tasks from our taskyon engine...
    const gdp = connectGdriveSync(stateRefs.appConfiguration.gdriveDir, ty.port, getGdriveToken)

    // Update your reactive refs when the connection is established
    watchEffect(() => {
      console.log('gdrive connection state changed:', gdp.gdriveConnected.value)
      gdriveConnected.value = gdp.gdriveConnected.value
      gdriveErrors.value = [...gdp.gdriveErrors.value]
    })

    watch(
      () => stateRefs.appConfiguration.enableGdriveSync,
      async (enable) => {
        if (enable) {
          await gdp.attemptConnect()
        } else gdp.disconnect()
      },
      { immediate: true },
    )

    return gdp
  })

  const { setNewSession, getDeviceId, newSessionFromGdrive, uploadSessionKey } =
    useSwitchCryptoSession(taskyon, gdp, registerUiToolsForCurrentSession)

  void taskyon.then(async (ty) => {
    stateRefs.setSessionId(await ty.getCryptoSession().getSessionId())
  })

  // TODO: this is soo  ugly..  we need to do something about this...
  const connectMessageIframe = async (id: string, iframe: HTMLIFrameElement, origin?: string) => {
    const instance = await taskyon
    return instance.connectMessageIframe(id, iframe, origin)
  }

  // TODO: use the proxies below to replae the "getTaskmanager" and all of that..
  /*const taskManager = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['taskManagerInstance']
  })*/

  const { taskWorkerWaiting, lastActiveTaskId, lastTaskState, workerStreamLogs, activeTaskIds } =
    connectWorkerStream(taskyon)

  const stopWorker = async (reason: string) => {
    console.log('stopping worker with reason:', reason)
    const instance = await taskyon
    instance.cancelCurrentRun(reason)
  }

  const { stream: chatCompletionStream, emit: chatCompletionConnector } =
    createStream<ChatCompletionStreamEvent>()
  // connect taskyon to this stream as soon as it is initialized...
  void taskyon.then((ty) => ty.chatCompletionStream(chatCompletionConnector))

  function setNewContentDraft(content: TaskNode['content'] | undefined) {
    if (content?.type === 'message') {
      stateRefs.messageDraft = content.data || ''
      stateRefs.createTaskType = { type: 'message' } // set the type to message
    } else if (content?.type === 'functioncall') {
      stateRefs.draftParameters[content.data.name] = content.data.arguments
      stateRefs.createTaskType = {
        type: 'functioncall',
        name: content.data.name,
      }
    } else {
      console.warn('Unknown content type:', content?.type)
      stateRefs.messageDraft = ''
      stateRefs.createTaskType = { type: 'message' } // default to message
    }
  }

  function setContentDraftFromTask(task: TaskNode | null) {
    // we are copying the current task with json stringify
    const jsonTask = JSON.stringify(task)
    const content = TaskNode.partial().parse(JSON.parse(jsonTask)).content
    setNewContentDraft(content)
  }

  const taskContentDraft = computed(() => {
    if (stateRefs.createTaskType.type === 'message') {
      return {
        type: 'message',
        data: stateRefs.messageDraft || '',
      }
    } else if (stateRefs.createTaskType.type === 'functioncall') {
      return {
        type: 'functioncall',
        functionName: stateRefs.createTaskType.name,
        arguments: stateRefs.messageDraft || '',
      }
    }
    return undefined
  })

  function switchTaskType(tasktype: string | undefined | null) {
    console.log('change tasktype to:', tasktype)
    if (tasktype) {
      const toolName = tasktype
      const tool = allTools.value[tasktype]
      if (!tool) {
        console.log(`Tool ${toolName} not found.`)
        return null
      }

      const savedParams = stateRefs.draftParameters[tasktype]
      const defaultParams = getDefaultParametersForTool(tool)

      setNewContentDraft({
        type: 'functioncall',
        data: {
          name: tasktype,
          arguments: savedParams || defaultParams,
        },
      })
    } else {
      setNewContentDraft({
        type: 'message',
        data: stateRefs.messageDraft || '',
      })
    }
  }

  const getMeta = async (id: string) => {
    const tm = await taskyon
    const meta = tm.getMeta(id)
    return meta
  }

  function getTaskMetaRef(taskId: string | undefined) {
    const taskMetaRef = ref<TaskNodeMeta>()
    let subscriptionUnsub: (() => void) | null = null
    if (taskId) {
      void taskyon.then((ty) => {
        void ty.getMeta(taskId).then((data) => {
          taskMetaRef.value = data || undefined
        })
        subscriptionUnsub = ty.metaLiveRead(taskId)(({ data }) => {
          taskMetaRef.value = data || undefined
        })
      })
    }
    onScopeDispose(() => {
      if (subscriptionUnsub) subscriptionUnsub()
    })
    return computed(() => taskMetaRef.value)
  }

  dynamicQuasarTheming(stateRefs)

  const entryNode = computed<partialTaskDraft>(() => ({
    role: 'system',
    content: {
      type: 'functioncall',
      data: {
        name: stateRefs.llmSettings.entryFunction,
        arguments: {},
      },
    },
  }))

  const tyready = ref(false)
  void taskyon.then(() => {
    tyready.value = true
  })

  return {
    tyready: computed(() => tyready),
    switchTaskyonSessionForBindingKey,
    addFile: async (file: File) => await uiTaskyonClient.files.add({ file }),
    setNewSession,
    newSessionFromGdrive,
    uploadSessionKey,
    getToken,
    getTaskMetaRef,
    getMeta,
    getDeviceId,
    taskyon,
    taskyonClient,
    taskTemplateRenderer,
    documentationBases,
    documentationReady,
    storageClient,
    resetTaskyonLocalStorageState,
    dagStorageBackend,
    designProjectStore,
    registerDesignProject,
    listDesignProjects,
    setNewContentDraft,
    setContentDraftFromTask,
    allTools: computed(() => allTools.value),
    switchTaskType,
    taskContentDraft,
    selectedThread,
    taskTreeRevision,
    currentTask,
    currentTaskResolutionStatus,
    markTasksPendingCreation,
    conversationHistory,
    resetCapabilityDecisions: () => getBrowserCapabilityPolicy().reset(),
    ...apiKeyManagement,
    stopWorker,
    taskWorkerWaiting,
    lastActiveTaskId,
    lastTaskState,
    workerStreamLogs,
    activeTaskIds,
    chatCompletionStream,
    connectMessageIframe,
    entryNode,
    api: uiApiOutside,
    gdp,
    getGdriveToken,
  }
}) // this state stores all information which
