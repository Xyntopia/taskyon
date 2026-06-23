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
  Thunk,
  tyPublicApiKeyObject,
  TyTaskStreamData,
} from '@taskyon/taskyon'
import {
  availableModels,
  base64ToPublixX25519,
  createDuplexChannel,
  createPortApi,
  createStream,
  createTypeFilteredPort,
  cryptoKeyToBase64,
  deriveKeyFromPwd,
  ensureValidTaskId,
  exclusive,
  getCurrentModel,
  getDefaultParametersForTool,
  isTaskyonKey,
  joinUrl,
  latestOnly,
  OAUTH_PROVIDERS,
  randomString,
  TaskNode,
  TaskyonMessage,
  TOKEN_SERVICE_BASE_URL,
  tyCore,
} from '@taskyon/taskyon'
import type { AuthenticationOptions } from '@taskyon/taskyon/browser'
import { usePersistentOauth, type TokenGetter } from '@taskyon/taskyon/browser'
import { createOAuthTool } from '@taskyon/taskyon/tools/authTools'
import type { chunkStreamType } from '@taskyon/taskyon/tools/chatCompletionTool'
import {
  createStandardEntryNodeTool,
  EntryNodeSettingsSchema,
} from '@taskyon/taskyon/tools/entryNode'
import { until } from '@vueuse/core'
import { default as Ajv } from 'ajv'
import type { JSONSchema7 } from 'json-schema'
import { defineStore } from 'pinia'
import { useQuasar } from 'quasar' // load dynamically! :)
import { freeKey } from 'src/assets/taskyon_free_key'
import { setColors } from 'src/boot/brand-colors'
import { useGdrive } from 'src/modules/gdrive'
import { setPrismTheme } from '@taskyon/shared/modules/markdownUtils '
import { TaskyonGuiMessage } from 'src/modules/taskyon/apiTypes'
import {
  initCryptoSessionFromBrowser,
  persistSession,
} from 'src/modules/taskyon/browserCryptoSession'
import { gDriveSyncPort } from 'src/modules/taskyon/sync'
import { type TyProfile } from 'src/modules/taskyon/types'
import { asyncComputed } from 'src/modules/vueUtils'
import { match, P } from 'ts-pattern'
import type { ReadonlyDeep } from 'type-fest'
import { computed, onScopeDispose, onWatcherCleanup, readonly, ref, watch, watchEffect } from 'vue'
import { sendFile } from '../../packages/taskyon/src/types/apiTypes'
import { guiTools } from '../modules/taskyon/GuiTools'
import { useAppStateStore } from './appState'
import { waitForIframeDuplexChannel } from './iframeClient'

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
  llmSettings: ReadonlyDeep<TyProfile['llmSettings']>,
  getApiKey: (name: string) => Promise<string | null>,
) {
  console.log('downloading models...')
  const api = llmSettings.llmApis[llmSettings.selectedApi || '']
  if (api) {
    // and also get a "fresh" list of models from the server...
    let baseURL: string
    try {
      baseURL = joinUrl(api.baseURL, api.routes.models)
    } catch (err) {
      console.warn('Invalid model URL', err)
      return {}
    }
    const taskyonApi = llmSettings.llmApis['taskyon']
    let key: string
    // we are doing this, because openrouter currently
    // blocks access to models from browser origins through CORS restrictions.
    if (taskyonApi && api.name === 'openrouter.ai') {
      baseURL = TOKEN_SERVICE_BASE_URL + '/api/models_openrouter'
      key = (await getApiKey('taskyon')) || (await getApiKey(api?.name)) || ''
    } else if (api.name === 'taskyon') {
      baseURL = TOKEN_SERVICE_BASE_URL + '/api/models'
      key = (await getApiKey('taskyon')) || ''
    } else {
      key = (await getApiKey(api.name)) || ''
    }
    try {
      const res = await availableModels(baseURL, key, api.defaultHeaders ?? {})
      return res
    } catch {
      console.log("couldn't download models from", baseURL)
      return {}
    }
  } else {
    return {}
  }
}

function connectWorkerStream(taskyon: Promise<Taskyon>) {
  const taskWorkerWaiting = ref(true)
  const workerStreamLogs = ref<(TyTaskStreamData & { timestamp: Date })[]>([])
  const maxLogRows = 50
  const lastActiveTaskId = ref<string | null>(null)
  const lastTaskState = ref(new Map<string, TyTaskStreamData['stage']>())
  const activeTaskIds = ref(new Set<string>())
  const taskFinishedStages = new Set<TyTaskStreamData['stage']>(['processed', 'error', 'aborted'])
  const taskActiveStages = new Set<TyTaskStreamData['stage']>(['processing', 'in loop', 'subtasks'])

  void taskyon.then(({ workerStream }) => {
    void workerStream((data) => {
      if (data.stage === 'all finished') taskWorkerWaiting.value = true
      else if (data.stage === 'processing') taskWorkerWaiting.value = false
    })

    void workerStream((data) => {
      console.log(`worker: ${data.stage}, ${data.taskId || data.task?.id}`)
      if (['all finished', 'processing', 'processed', 'error', 'aborted'].includes(data.stage)) {
        workerStreamLogs.value.push({ ...data, timestamp: new Date() })
        // Ensure the log doesn't exceed the maximum number of rows
        if (workerStreamLogs.value.length > maxLogRows) {
          workerStreamLogs.value.shift() // Remove the oldest entry
        }
      }
    })

    void workerStream((data) => {
      const id = data.task?.id || data.taskId
      if (data.stage === 'all finished' || (data.stage === 'aborted' && !id)) {
        // "all finished" and global abort do not carry a task id, so clear stale in-progress states.
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
        data.stage === 'processed' ||
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
  // TODO:
  //'How do I execute python code?',
  //'how about testing out javascript? e.g. create some widgets on the fly...',
  //'What are AI tools?',
  //'How do I integrate Taskyon into my webpage?',
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
    'addTasks',
    'requestTask',
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
): InternalTool[] {
  return [
    ...guiTools,
    createOAuthTool(ty.setSecret),
    {
      function: ({ newPrompts }) => {
        console.log('Modifying prompts in llmSettings...')
        const promptTemplates = stateRefs.toolchainConfig.entryNode?.prompt_templates
        if (
          !promptTemplates ||
          typeof promptTemplates !== 'object' ||
          Array.isArray(promptTemplates) ||
          !('basePrompt' in promptTemplates) ||
          !stateRefs.toolchainConfig.entryNode
        ) {
          throw new Error('No prompt templates defined in entryNode settings!')
        }
        const newPromptsMerged = {
          ...promptTemplates,
          ...newPrompts,
        }
        const ajv = new Ajv()
        const validate = ajv.compile(EntryNodeSettingsSchema.properties.prompt_templates)
        const valid = validate(newPromptsMerged)
        if (valid) {
          stateRefs.toolchainConfig.entryNode.prompt_templates = newPromptsMerged
          console.log('Prompts modified:', stateRefs.toolchainConfig.entryNode?.prompt_templates)
        } else {
          throw new Error(
            `It was not possible to add prompts for ${JSON.stringify(Object.keys(newPrompts))} to
  ${JSON.stringify(Object.keys(stateRefs.toolchainConfig.entryNode?.prompt_templates ?? {}))}. Did you use the wrong
  keys and are they all defined as string?`,
          )
        }
      },
      description: 'Modify the prompt templates used by the entry node.',
      longDescription:
        'This tool allows you to modify the prompt templates owned by the entry node.',
      name: 'modifyPrompts',
      parameters: {
        type: 'object',
        properties: {
          newPrompts: {
            type: 'object',
            description: 'An object containing the new prompts.',
            properties: EntryNodeSettingsSchema.properties.prompt_templates.properties,
          },
        },
        required: ['newPrompts'],
      } as const satisfies JSONSchema7,
    },
  ]
}

export const AiProvideKeyStoreName = 'AiProviderKey'

function resolveTaskyonKey(args: {
  authToken?: KeyString | undefined
  iframeToken?: KeyString | undefined
  storedKeyStr?: KeyString | undefined
}) {
  const { authToken, iframeToken, storedKeyStr } = args
  console.log('found stored key:', storedKeyStr?.slice(-5))

  return (iframeToken ??
    // only use stored key if it isn't a free key and if it is a taskyon key
    (storedKeyStr === freeKey
      ? undefined
      : isTaskyonKey(storedKeyStr, true)
        ? storedKeyStr
        : undefined) ??
    authToken ??
    freeKey) as KeyString
}

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

  function getSelectedModel() {
    const selected = stateRefs.llmSettings.selectedApi
    if (selected) {
      const api = stateRefs.llmSettings.llmApis[selected]
      if (api) {
        return getCurrentModel(api)
      }
    }
  }

  const updateModelList = latestOnly(async () => {
    console.log('Update model list!')
    const m = await updateLlmModels(stateRefs.llmSettings, getProviderApiKey)
    llmModelsInternal.value = m
  })

  // TODO: add apis to model history as well!
  const addModelToHistory = (model: string) => {
    if (stateRefs.modelHistory.length >= 5) {
      stateRefs.modelHistory.shift() // remove oldest element
    }
    stateRefs.modelHistory.push(model)
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
      'old name':
        stateRefs.llmSettings.llmApis[stateRefs.llmSettings.selectedApi || '']?.selectedModel,
      'old service': stateRefs.llmSettings.llmApis[stateRefs.llmSettings.selectedApi || '']?.name,
    })

    if (newService) {
      stateRefs.setLLMSettings('selectedApi', newService)
    }
    if (stateRefs.llmSettings.selectedApi) {
      console.log('update model for api:', stateRefs.llmSettings.selectedApi, newName)
      stateRefs.setLLMSettings(
        ['llmApis', stateRefs.llmSettings.selectedApi, 'selectedModel'],
        newName,
      )
    }
    addModelToHistory(newName)
  }

  const taskyonKey = computed(() => {
    const api = stateRefs.llmSettings.selectedApi
    if (api === 'taskyon') {
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
    const api = stateRefs.llmSettings.selectedApi
    if (api) return availableKeys.value[api] ?? null
    return null
  })

  const usingFreeTaskyonKey = computed(() => {
    const useFreeKey =
      stateRefs.llmSettings.selectedApi === 'taskyon' && availableKeys.value['taskyon'] === freeKey
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

  const setProviderApiKey = exclusive(async (name: string, value: KeyString | undefined) => {
    console.log('set new provider key:', name, value?.slice(-5))
    const ty = await taskyon()
    if (!value) {
      await ty.deleteSecret(AiProvideKeyStoreName, name)
      await ty.updateChatCompletionApiKey(name, undefined)
    } else {
      await ty.setSecret(AiProvideKeyStoreName, name, value)
      await ty.updateChatCompletionApiKey(name, value)
    }
    // and keep track of it internally
    availableKeys.value[name] = value
  })

  ///////////   computed properties
  const providerDefs = computed(() => Object.keys(stateRefs.llmSettings.llmApis))
  const availableProviders = computed(() => {
    //return Array.from(new Set(availableKeys.value).intersection(new Set(providerDefs.value)))
    return Object.keys(availableKeys.value)
  })

  // Computed property to determine the currently selected bot name
  const currentModelId = computed(getSelectedModel)

  const currentModel = computed(() => {
    return currentModelId.value ? llmModelsInternal.value[currentModelId.value] : null
  })

  const noAiService = asyncComputed(async () => {
    if (stateRefs.llmSettings.selectedApi) {
      const apiK = await getProviderApiKey(stateRefs.llmSettings.selectedApi)
      return apiK == null
    } else return true
  }, true)

  function getValidModel(key: tyPublicApiKeyObject) {
    const cm = getSelectedModel()
    console.log('currently selected model', cm)
    const keyModels = getKeyModels(key)
    if (cm && keyModels?.includes(cm)) {
      console.log('currrent model is already in allowed list!', cm, tyKeyAllowedModels.value)
    } else if (cm) {
      console.log('currently selected model is not in allowed list', tyKeyAllowedModels.value, cm)
      return keyModels?.[0] ?? cm
    }
  }

  const getStoredTaskyonKey = async () => (await getProviderApiKey('taskyon')) ?? undefined

  const ensureValidModel = (keystr?: KeyString) => {
    if (stateRefs.llmSettings.selectedApi !== 'taskyon') {
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
      authToken: stateRefs.authToken,
      iframeApiKey: stateRefs.iframeApiKey,
    })

    let storedKeyStr = await getStoredTaskyonKey()
    if (shouldUpdateFreeKey(storedKeyStr)) storedKeyStr = freeKey as KeyString
    const selectedKey = resolveTaskyonKey({
      authToken: stateRefs.authToken,
      iframeToken: stateRefs.iframeApiKey,
      storedKeyStr,
    })
    // update the secretstore with this key in order to give chatCompletion the correct key!
    console.log('setting selected key:', selectedKey?.slice(-5))
    await setProviderApiKey('taskyon', selectedKey)
    ensureValidModel(selectedKey)

    const keys = await ty.listSecrets(AiProvideKeyStoreName)
    availableKeys.value = keys
  }

  // make sure we update our model list whenever anything changes for our
  // endpoints...
  // TODO: there is a potential infinite loop here with
  // TODO: get rid of this..  we need this to be explicit!
  // "ensureValidModel" setting a new "selectedModel" inside stateRefs.llmSettings.llmApis
  //  which then triggers this watch again... we need to be careful here!
  watch(
    [() => stateRefs.llmSettings.selectedApi, () => stateRefs.llmSettings.llmApis, availableKeys],
    async ([newSelectedApi, newApiConfigs, availableKeys]) => {
      console.log('update models... due to api/key change', {
        newSelectedApi,
        newApiConfigs,
        availableKeys,
      })
      if (newSelectedApi === 'taskyon') {
        console.log('ensure, we have a valid model for taskyon key...')
        const selectedKey = resolveTaskyonKey({
          authToken: stateRefs.authToken,
          iframeToken: stateRefs.iframeApiKey,
          storedKeyStr: await getStoredTaskyonKey(),
        })
        ensureValidModel(selectedKey)
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
    noAiService,
    setProviderApiKey,
    getProviderApiKey,
    // Method to handle the updateBotName event
    updateModelAndApi,
    llmModels: computed(() => llmModelsInternal.value),
  }
}

function taskUiUpdates(taskyon: Promise<Taskyon>, stateRefs: ReturnType<typeof useAppStateStore>) {
  // we are using refs here for selectedThread and currentTask isntead of a computed reference, because
  // we want to oad them gradually into our UI
  const currentTask = ref<TaskNode | null>(null)
  const pendingCreatedTaskIds = ref(new Set<string>())
  const taskSelectionRevision = ref(0)
  const currentTaskResolutionStatus = ref<'idle' | 'loading' | 'resolved' | 'missing'>('idle')

  function markTasksPendingCreation(taskIds: readonly string[]) {
    const nextPending = new Set(pendingCreatedTaskIds.value)
    for (const taskId of taskIds) {
      nextPending.add(taskId)
    }
    pendingCreatedTaskIds.value = nextPending
    taskSelectionRevision.value += 1
  }

  void taskyon.then((ty) => {
    const add2ChatHistory = async (
      task: TaskNode | null,
      id: string,
      msg: 'existing' | 'update' | 'delete' | 'deleteAll',
    ) => {
      console.log('update task history!!', id, msg)
      if (id === stateRefs.chatHistory[0]) {
        return
      }

      if (msg === 'update') {
        // we need to make sure, that our task is not already
        // the "parent" of another task in that case we only want the leaf task which is already present...
        for (const taskId of stateRefs.chatHistory) {
          const otherTask = await ty.getTask(taskId)
          if (otherTask?.priorID === id || otherTask?.parentID === id) return
        }
      } else if (msg === 'delete') {
        // Filter out the deleted task ID
        stateRefs.chatHistory = stateRefs.chatHistory.filter((t) => t !== id)
        return
      } else if (msg === 'deleteAll') {
        // Clear history
        stateRefs.chatHistory = []
        return
      }

      // Check if the task already exists in the history
      if (!stateRefs.chatHistory.includes(id)) {
        // Add the task to the front of the list if it doesn't exist
        stateRefs.chatHistory.unshift(id)
      }

      // Remove task.id if it exists, then unshift to front (avoids duplication)
      // we do this every time something gets added to the history
      // we are not doin this anymore, because it gets too confusing for poeple ;)
      /*stateRefs.chatHistory = [
      task.id,
      ...stateRefs.chatHistory.filter((t) => t !== task.id),
    ];*/

      if (!task) return

      // Remove any entries which are a parent of the current task (keeping only leaf IDs)
      const currentTaskChain = (await ty.getTaskIdChain(task.id, 50)).slice(0, -1)
      stateRefs.chatHistory = stateRefs.chatHistory.filter(
        (t) => t !== task.priorID && t !== task.parentID && !currentTaskChain.includes(t),
        //(t) => t !== task.priorID && t !== task.parentID,
      )

      // Enforce a maximum size of 50
      if (stateRefs.chatHistory.length > 50) {
        stateRefs.chatHistory.length = 50 // Trims excess elements from the end
      }

      // and sort all tasks according to their timestamp :)
      // TODO: we can't do this right now, because the task timestamp is optional
      //       and we want to make sure to really include all tasks in the chathistory...
    }

    ty.taskStream(({ id, data: task }) => {
      if (!task) {
        void add2ChatHistory(task, id.toString(), 'delete')
        return
      }
      if (pendingCreatedTaskIds.value.has(id.toString())) {
        const nextPending = new Set(pendingCreatedTaskIds.value)
        nextPending.delete(id.toString())
        pendingCreatedTaskIds.value = nextPending
        taskSelectionRevision.value += 1
      }
      const selectedTaskId = stateRefs.selectedTaskId
      if (
        selectedTaskId &&
        selectedTaskId !== id &&
        (task.parentID === selectedTaskId || task.priorID === selectedTaskId)
      ) {
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
          const task = await ty.getTask(newSelectedTask)
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
        if (newValue) void add2ChatHistory(newValue, newValue.id, 'update')
      },
      { once: true },
    )

    // also update chat history if we switch between tasks...
    watch(
      () => [stateRefs.selectedTaskId, stateRefs.taskyonSessionStatus] as const,
      async ([selectedTask, sessionStatus]) => {
        if (selectedTask && sessionStatus === 'ready') {
          const taskNode = await ty.getTask(selectedTask)
          if (taskNode) void add2ChatHistory(taskNode, taskNode.id, 'existing')
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
        const selectedThreadIDs = await ty.getTaskIdChain(newSelectedTask)
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
    currentTask: computed(() => currentTask),
    currentTaskResolutionStatus: computed(() => currentTaskResolutionStatus.value),
    markTasksPendingCreation,
  }
}

function reactiveTools(taskyon: Promise<Taskyon>) {
  const allTools = ref<Record<string, InternalTool>>({})

  void taskyon.then((ty) => {
    const updateTools = async () => {
      allTools.value = await ty.updateToolDefinitions(true)
    }
    void updateTools()

    // if a new "default" tool was created update UI
    // TODO: can we move this into our init.ts? or does it make sense here?
    ty.port.receive((msg) => {
      console.log('api out message!', msg)
      void match(msg).with(
        {
          type: 'status',
          data: {
            type: 'newtool',
            id: P.select(),
          },
        },
        (id) => {
          console.log('Default Tool definition was added to taskyon!', id)
          void updateTools()
        },
      )
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
  // this means previously, we have loaded a session with a binding key.
  // so we would like to wait a little bit, if we will get that same binding key...
  const taskyon = (async () => {
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
  })().then(async (cs) => {
    const entryNode = () =>
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
    const entryNodeTool = createStandardEntryNodeTool({
      name: getEntryNodeToolName(entryNode()),
      renderOptions: { hideChat: true, hideLlm: true },
      toolChooser: { enabled: true, useTools: true },
      defaultAllowedTools: [],
      getToolCatalog: async () => {
        const cachedTools =
          Object.keys(allTools.value).length > 0
            ? allTools.value
            : await (await taskyon).updateToolDefinitions(true)
        return Object.values(cachedTools)
          .filter((tool) => !['chatCompletion', 'entryNode', 'taskyonFlow'].includes(tool.name))
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
          }))
      },
    })
    return await tyCore(
      () => ({
        ...stateRefs.llmSettings,
        entryNode: entryNode(),
      }),
      entryNode,
      () => stateRefs.toolchainConfig,
      [entryNodeTool],
      cs,
    )
  })

  void taskyon.then(async (ty) => {
    ty.addDefaultTools(defineTyGuiTools(stateRefs, ty))
    await ty.updateToolDefinitions(false)
  })

  const apiKeyManagement = useApiManagement(stateRefs, () => taskyon)
  void apiKeyManagement.initModelsAndStoredKeys()

  // switch user session on key change!
  watch(
    () => stateRefs.bindingKey,
    async (newkey) => {
      console.log('new binding key', newkey)
      stateRefs.setTaskyonSessionSwitching(true)

      let cancelled = false
      onWatcherCleanup(() => {
        // This runs when the watcher re-triggers
        cancelled = true
      })
      const cs = await initCryptoSessionFromBrowser(
        {
          bindingKey: newkey ?? undefined,
        },
        true,
      )
      try {
        if (cancelled) return
        const ty = await taskyon
        const newId = await cs.getSessionId()
        const oldId = await ty.getCryptoSession().getSessionId()
        if (cancelled) return

        if (newId !== oldId) {
          console.log(`switch user session because of binding key change! ${oldId}->${newId}`)
          await ty.setNewSession(cs)
          // after we are finished switching, we can officially chang ethe session id...
          stateRefs.setSessionId(newId)
          // and re-init our api key management with new session...
          await apiKeyManagement.initModelsAndStoredKeys()
        }
      } finally {
        if (!cancelled) stateRefs.setTaskyonSessionSwitching(false)
      }
    },
  )

  const { currentTask, currentTaskResolutionStatus, markTasksPendingCreation, selectedThread } =
    taskUiUpdates(taskyon, stateRefs)

  // iApiOutside is the port to the "outside" of taskyon UI. It is the port used to
  // communicate towards the taskyon engine. iApiInside communicates to the outside of taskyon.
  // For example the iframe is connected to iApiOutside because
  // it lives outside the taskyon logic. iApiInside is used by our internal
  // services e.g. the engine to communicate to the outside.
  const { x: uiApiOutside, y: uiApiInside } = createDuplexChannel<
    TaskyonGuiMessage,
    TaskyonGuiMessage
  >()

  void taskyon.then(async (ty) => {
    //const taskStream = tyInit.taskManagerInstance.taskStream
    //syncToGdrive(taskStream, stateRefs.appConfiguration.gdriveDir)

    // add an API for taskyon GUI and make sure "unused" messages are routed through to the
    // taskyon engine!
    // TODO: red-define this as a middleware where we can intercept certain messages
    //       and also change the types of inside/outside ports...
    uiApiInside.receive((msg) => console.log('received message on UI port!', msg))
    createPortApi(
      uiApiInside,
      TaskyonGuiMessage,
      {
        configurationMessage: async (msg) => {
          const newConfig = msg.conf
          const llmCfg = newConfig.llmSettings as Partial<TyProfile['llmSettings']> | undefined
          const appCfg = newConfig.appConfiguration as
            | Partial<TyProfile['appConfiguration']>
            | undefined
          if (typeof msg.profileName === 'string' && msg.profileName.trim()) {
            stateRefs.setActiveProfile(msg.profileName)
          }
          const explicitNoBindingKey = msg.missingBindingKeyPolicy === 'noBindingKey'
          if (explicitNoBindingKey) {
            stateRefs.setBindingKey(null, 'unknown')
          }
          if (msg.bindingKey !== undefined && msg.bindingKey !== null) {
            if (msg.bindingKey instanceof CryptoKey) {
              stateRefs.setBindingKey(msg.bindingKey, 'unknown')
            } else if (typeof msg.bindingKey === 'string' && msg.bindingKey.trim()) {
              try {
                const importedBindingKey = await base64ToPublixX25519(msg.bindingKey, false)
                stateRefs.setBindingKey(importedBindingKey, 'unknown')
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
            hasToolchainConfig: !!newConfig.toolchainConfig,
            hasSignatureOrKey: !!newConfig.signatureOrKey,
            selectedApi: llmCfg?.selectedApi,
            incomingPrimaryColor: appCfg?.primaryColor,
            incomingSecondaryColor: appCfg?.secondaryColor,
          })
          stateRefs.overRideSettings(newConfig, !!msg.persist)
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
        pasteMessage: (msg) => {
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
        task: async (msg) => {
          // push the last task to execution queue right away...
          await ensureValidTaskId(msg.task)
          ty.port.send(msg)
          // we don't forward this message to outPort, because we 've already processed everything relevant here..
        },
      },
      // simply send all other messages to our backend...
      (msg) => {
        const m = TaskyonMessage.safeParse(msg)
        if (m.success) ty.port.send(m.data)
        else console.log('unknown message:', m.data)
      },
    )
    // we manually connect our send port to the api here, because
    // we are already intercepting incoming messages with the API above
    // TODO: we have to change this! we would like to
    ty.port.receive(uiApiInside.send)

    console.log('checking if we are in an iframe!')

    /// -------   IFRAME operations --------
    // We load the iframe here with the iframe=true parameter to make test in cypress work!
    // set up iframe API and hook it up to our taskyon api
    //if ($q.platform.within.iframe) {
    if (stateRefs.isInIframe) {
      console.log('taskon is in iframe!, waiting for message port!')
      stateRefs.taskyonRunmode = 'waiting for connection'
      const iframePort = await waitForIframeDuplexChannel()
      // connect iframe API to internal GUI API which also connects to taskyon engine automatically.
      iframePort.connect(uiApiOutside)
      iframePort.send('taskyon connected!')
      console.log('taskyon connected to iframe!')
      stateRefs.taskyonRunmode = 'connected'
    }
    // ------------end of IFRAME operations-------
  })

  // make sure we always have an up-to-date list of tools
  const allTools = reactiveTools(taskyon)

  // an oauth token getter function which persists secrets in our local secretstore!
  const getToken: TokenGetter = async (...args) => {
    const STORAGE_PREFIX = 'oauth:credentials:'
    const ty = await taskyon
    const tg = usePersistentOauth({
      getSecret: async (name) => await ty.getSecret(STORAGE_PREFIX, name, false),
      setSecret: async (name, data) => await ty.setSecret(STORAGE_PREFIX, name, data as KeyString),
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
    useSwitchCryptoSession(taskyon, gdp)

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
    instance.workerStop(reason)
  }

  const { stream: chatCompletionStream, emit: chatCompletionConnector } =
    createStream<chunkStreamType>()
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
    addFile: (file: File) => sendFile(uiApiOutside.send)(file),
    setNewSession,
    newSessionFromGdrive,
    uploadSessionKey,
    getToken,
    getTaskMetaRef,
    getMeta,
    getDeviceId,
    taskyon,
    setNewContentDraft,
    setContentDraftFromTask,
    allTools: computed(() => allTools.value),
    switchTaskType,
    taskContentDraft,
    selectedThread,
    currentTask,
    currentTaskResolutionStatus,
    markTasksPendingCreation,
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
