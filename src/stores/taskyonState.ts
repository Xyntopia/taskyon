import { defineStore } from 'pinia'
import { watch, computed, ref } from 'vue'
import type { ChatResponseType, TaskNodeMeta, TyTaskStreamData } from 'src/modules/taskyon/types'
import { type Model, getCurrentModel, llmSettings, type TyProfile } from 'src/modules/taskyon/types'
import axios from 'axios' // TODO: replace with fetch
import { Notify } from 'quasar' // load dynamically! :)
import { useQuasar } from 'quasar'
import { getApiConfig } from 'src/modules/taskyon/types'
import { initTaskyon } from 'src/modules/taskyon/init'
import { availableModels } from 'src/modules/taskyon/chat'
import { getDefaultParametersForTool } from 'src/modules/taskyon/tools'
import { useAppStateStore } from './appState'
import {
  createDuplexChannel,
  createPortApi,
  filter,
  MessageChannelBridge,
} from 'src/modules/frpBus'
import { generateRsaOaepPair } from 'src/modules/crypto_webcrypto'
import { setColors } from 'src/boot/brand-colors'
import { setPrismTheme } from 'src/modules/markdownUtils '
import { onScopeDispose } from 'vue'
import { waitForMessagePort } from 'src/modules/taskyon/iframeWorker'
import { guiTools } from 'src/modules/tools/GuiTools'
import { TaskyonMessage } from 'src/modules/taskyon/apiTypes'
import { match, P } from 'ts-pattern'
import type { InternalTool, Asyncify } from '@taskyon/taskyon'
import { TaskNode } from '@taskyon/taskyon'
import { toolCall } from '@taskyon/taskyon'

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

export function getReasoning(meta: TaskNodeMeta | undefined) {
  return (
    meta?.rawOutput as {
      choice?: ChatResponseType['choices'][0]
    }
  )?.choice?.reasoning
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

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0]
    window.history.pushState({}, document.title, baseUrl)
  }
}

async function updateLlmModels(
  llmSettings: TyProfile['llmSettings'],
  keys: Record<string, string>,
) {
  console.log('downloading models...')
  const api = getApiConfig(llmSettings)
  if (api) {
    // and also get a "fresh" list of models from the server...
    let baseURL = api.baseURL + api.routes.models
    let key = keys[api?.name] || ''
    const taskyonApi = llmSettings.llmApis['taskyon']
    // we are doing this, because openrouter currently
    // blocks access from browser origins through CORS.
    if (taskyonApi && api.name === 'openrouter.ai') {
      baseURL = taskyonApi.baseURL + '/models_openrouter'
      key = keys.taskyon || keys[api?.name] || ''
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

export const useTaskyonStore = defineStore('taskyonControl', () => {
  console.log('loading taskyon store!')

  const $q = useQuasar()

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

  // load our store with all the settings
  // we use this here to confgure out taskyon logic
  const stateRefs = useAppStateStore()

  stateRefs.appConfiguration.chatSuggestions = ChatSuggestions

  watch(
    () => stateRefs.llmSettings.selectedApi,
    (newValue) => {
      console.log('api switch detected', newValue)
    },
  )

  let loadingKey = false
  async function getOpenRouterPKCEKey(code: string) {
    if (loadingKey == false) {
      console.log('start openai PKCE')
      loadingKey = true
      try {
        const response = await axios.post<{ key: string }>(
          'https://openrouter.ai/api/v1/auth/keys',
          {
            code: code,
          },
        )
        const data = response.data
        console.log('downloaded key:', data.key)
        if (data.key) {
          Notify.create('API Key retrieved successfully')
          stateRefs.keys['openrouter.ai'] = data.key
          stateRefs.llmSettings.selectedApi = 'openrouter.ai'
        } else {
          Notify.create('Failed to retrieve API Key')
        }
      } catch (error) {
        console.error('Error fetching API Key:', error)
        Notify.create('Error occurred while fetching API Key')
      }
      removeCodeFromUrl() // Remove the 'code' from URL
      loadingKey = false
    }
  }

  function defineTyGuiTools(): InternalTool[] {
    return [
      ...guiTools,
      {
        function: ({ newPrompts }: { newPrompts: { [key: string]: string } }) => {
          console.log('Modifying prompts in llmSettings...')
          const newPromptsMerged = {
            ...stateRefs.llmSettings.taskChatTemplates,
            ...newPrompts,
          }
          const result = llmSettings.shape.taskChatTemplates.strict().safeParse(newPromptsMerged)
          if (result.success) {
            stateRefs.llmSettings.taskChatTemplates = result.data
            console.log('Prompts modified:', stateRefs.llmSettings.taskChatTemplates)
          } else {
            return `It was not possible to add prompts for ${JSON.stringify(Object.keys(newPrompts))} to
  ${JSON.stringify(Object.keys(stateRefs.llmSettings.taskChatTemplates))}. Did you use the wrong
  keys and are they all defined as string?`
          }
        },
        description: 'Modify the current prompts in llmSettings',
        longDescription:
          'This tool allows you to modify the current prompts in llmSettings. You can provide a new set of prompts as an object, where each key is the prompt name and the value is the new prompt content.',
        name: 'modifyPrompts',
        parameters: {
          type: 'object',
          properties: {
            newPrompts: {
              type: 'object',
              description:
                'An object containing the new prompts, where each key is the prompt name and the value is the new prompt content.',
              default: '',
            },
          },
          required: ['newPrompts'],
        },
      },
    ]
  }

  // callin ExecutionContext.interrupt();  cancels processing of current task
  console.log('initialize taskyon')

  // TODO: move this into our taskyon library...
  const entryNode = computed(() => {
    return (
      stateRefs.llmSettings.entryNode ??
      toolCall({
        name: 'chooseTool',
        arguments: {
          llmTools: stateRefs.llmSettings.enableOpenAiTools,
        },
      })
    )
  })

  const { x: iApiIn, y: iApiOut } = createDuplexChannel<TaskyonMessage, unknown>()

  const initTaskyonPromise = (async () => {
    const tyInit = await initTaskyon(
      stateRefs.llmSettings,
      stateRefs.keys,
      defineTyGuiTools(),
      // TODO: right now, we're simply generating a reandom keypair for every launch
      //       so recovery is currenty impossible. We would like to give te user the ability
      //       to save this recovery key somewhere else in order to be able to recover their passwords.
      async () => (await generateRsaOaepPair()).publicKey,
    )

    // add an API for taskyon GUI and make sure "unused" messages are routed through to the
    // taskyon engine!
    createPortApi(
      iApiOut,
      TaskyonMessage,
      {
        configurationMessage: (msg) => {
          const newConfig = msg.conf
          console.log('setting our configuration')
          stateRefs.overRideSettings(newConfig, !!msg.persist)
          // let taskyon do more configurations

          // and also set a possible signature as the api key!
          if (stateRefs.llmSettings.selectedApi && newConfig.signatureOrKey) {
            // we only set the API key, if it was provided by the
            // parent app.
            const newKey = newConfig.signatureOrKey
            if (typeof newKey === 'string') {
              stateRefs.keys[stateRefs.llmSettings.selectedApi] = newKey
            } else {
              console.warn('Provided signatureOrKey is not a string:', newKey)
            }
          }

          // TODO:  set taskyon-relevant settings in the "backend"
          //tyInit.outPort.send(msg)
        },
        task: async (msg) => {
          // TODO: replace by rpc call to outPort
          const tn = await tyInit.taskManagerInstance.addPartialTask2Tree(
            { ...msg.task, label: msg.origin ? [msg.origin] : undefined },
            undefined,
            undefined,
          )
          // push the last task to execution queue right away...
          if (msg.execute) {
            tyInit.queueTask(tn.id)
          }
          if (msg.show) {
            stateRefs.setSelectedTask(tn.id)
          }
          // we don't forward this message to outPort, because we 've already processed everything relevant here..
        },
      },
      // simply send all other messages to our backend...
      (msg) => tyInit.outPort.send(msg),
    )
    // we manually connect our send port to the api here, because
    // we are already intercepting incoming messages with the API above
    tyInit.outPort.receive(iApiOut.send)
    console.log('checking if we are in an iframe!')

    /// -------   iframe operations --------
    // We load the iframe here with the iframe=true parameter to make test in cypress work!
    const searchParams = new URLSearchParams(window.location.search)
    const isIframeParam = searchParams.get('iframe') === 'true'
    console.log('we are in an iframe via param:', isIframeParam)
    const isInIframe = window.self !== window.top || isIframeParam
    console.log('we are in an iframe:', window.self !== window.top, isInIframe)
    // set up iframe API and hook it up to our taskyon api
    //if ($q.platform.within.iframe) {
    if (isInIframe) {
      console.log('taskon is in iframe!, waiting for message port!')
      const mport = await waitForMessagePort((ev) => {
        // Check if the message is from the parent window
        return ev.source === window.parent && ev.data?.type === 'initPort'
        // Optionally, check the origin if you know what it should be
        // For example, if you expect messages only from 'https://example.com'
        /*if (event.origin === 'https://example.com') {
                  console.log('Request from parent:', event.data);
                } else {
                  console.error('Message from unknown origin:', event.origin);
                }*/
        //console.log('Message from unknown origin:', event.origin, event)
      })
      // create a channel from the mport:
      const iframeChannel = createDuplexChannel<TaskyonMessage, unknown>()
      // connect the MessageChannel to our UI API
      MessageChannelBridge(iframeChannel.x, mport)

      // connect iframe API to internal GUI API which also connects to taskyon engine automatically.
      iframeChannel.y.connect(iApiIn)
      mport.postMessage('taskyon connected!')
    }
    return tyInit
  })()

  // Access taskManagerInstance and addTask2Tree without redundant awaits
  const getTaskManager = async () => (await initTaskyonPromise)['taskManagerInstance']

  // make sure we always have an up-to-date list of tools
  const allTools = ref<Record<string, InternalTool>>({})
  void getTaskManager().then((tm) => {
    const updateTools = async () => {
      allTools.value = await (await getTaskManager()).updateToolDefinitions(true)
    }
    void updateTools()

    // if a new "default" tool was created update UI
    iApiIn.receive((msg) => {
      console.log('api Aout message!', msg)
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
    tm.taskStream.subscribe(
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

  const secretStore = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['secretStore']
  })

  const connectMessageIframe = async (id: string, iframe: HTMLIFrameElement, origin?: string) => {
    const instance = await initTaskyonPromise
    return instance['connectMessageIframe'](id, iframe, origin)
  }

  // Use a fixed key for demo purposes (not secure for production!)
  const fixedKeyBytes = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 32,
  ]) // 32 bytes = 256 bits

  void secretStore.onSessionKey(async ({ respond }) => {
    console.log('importing fixed key for secretStore...')
    // Import the fixed key as an AES-GCM CryptoKey
    // this means our secretStore is "de-facto" non encrypted
    // TODO: generate a good session key by either using passKey or a password.
    const key = await window.crypto.subtle.importKey(
      'raw',
      fixedKeyBytes,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    )
    respond(key)
  })

  // TODO: use the proxies below to replae the "getTaskmanager" and all of that..
  /*const taskManager = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['taskManagerInstance']
  })*/

  async function addToProcessQueue(taskId: string) {
    ;(await initTaskyonPromise).queueTask(taskId)
  }

  const workerStream = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['workerStream']
  })

  const stopWorker = async (reason: string) => {
    console.log('stopping worker with reason:', reason)
    const instance = await initTaskyonPromise
    instance.workerStop(reason)
  }

  const chatCompletionStream = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['chatCompletionStream']
  })

  const workerStreamLogs = ref<(TyTaskStreamData & { timestamp: Date })[]>([])
  const maxLogRows = 50
  void workerStream.subscribe((data) => {
    console.log(`worker: ${data.stage}, ${data.taskId || data.task?.id}`)
    if (['all finished', 'processing', 'processed', 'error'].includes(data.stage)) {
      workerStreamLogs.value.push({ ...data, timestamp: new Date() })
      // Ensure the log doesn't exceed the maximum number of rows
      if (workerStreamLogs.value.length > maxLogRows) {
        workerStreamLogs.value.shift() // Remove the oldest entry
      }
    }
  })

  const lastTaskState = ref(new Map<string, TyTaskStreamData['stage']>())
  void workerStream.subscribe((data) => {
    const id = data.task?.id || data.taskId
    if (id) {
      lastTaskState.value.set(id, data.stage)
      if (data.stage === 'processed') {
        // we don't need the task anymore once we're done processing with it :)
        lastTaskState.value.delete(id)
      }
    }
  })

  void initTaskyonPromise.then(({ workerStream }) => {
    filter(
      workerStream,
      (data) =>
        data.stage === 'processing' ||
        data.stage === 'processed' ||
        data.stage === 'error' ||
        (data.stage === 'aborted' && !!(data.taskId || data.task?.id)),
    ).subscribe((data) => {
      // TODO: add last task to GUI by checking if our current selected task now has this child...
      stateRefs.setSelectedTask(data.task?.id || data.taskId || null)
    })
  })

  void workerStream.subscribe((data) => {
    if (data.stage === 'all finished') taskWorkerWaiting.value = true
    else if (data.stage === 'processing') taskWorkerWaiting.value = false
  })

  void getTaskManager().then((tm) => {
    tm.taskStream.subscribe(({ id, data: task }) => {
      if (!task) {
        void add2ChatHistory(task, id.toString(), 'delete')
      }
      if (currentTask.value?.id === id) {
        // console.log('update current task...', task)
        currentTask.value = task
      }
    })
  })

  const add2ChatHistory = async (
    task: TaskNode | null,
    id: string,
    msg: 'existing' | 'update' | 'delete' | 'deleteAll',
  ) => {
    console.log('update task history!!', id, msg)
    if (id === stateRefs.chatHistory[0]) {
      return
    }
    const tm = await getTaskManager()

    if (msg === 'update') {
      // we need to make sure, that our task is not already
      // the "parent" of another task in that case we only want the leaf task which is already present...
      for (const taskId of stateRefs.chatHistory) {
        const otherTask = await tm.getTask(taskId)
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
    const currentTaskChain = (await tm.getTaskIdChain(task.id, 50)).slice(0, -1)
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

  // also update chat history if we switch between tasks...
  watch(
    () => stateRefs.llmSettings.selectedTaskId,
    async (selectedTask) => {
      const tm = await getTaskManager()
      if (selectedTask) {
        const taskNode = await tm.getTask(selectedTask)
        if (taskNode) void add2ChatHistory(taskNode, taskNode.id, 'existing')
      }
    },
    { immediate: true },
  )

  function addModelToHistory(model: string) {
    if (stateRefs.modelHistory.length >= 5) {
      stateRefs.modelHistory.shift() // remove oldest element
    }
    stateRefs.modelHistory.push(model)
  }

  const llmModelsInternal = ref<Record<string, Model>>({})
  // make sure we update our model list whenever anything changes for our
  // endpoints...
  watch(
    [() => stateRefs.llmSettings.selectedApi, stateRefs.keys, stateRefs.llmSettings.llmApis],
    () => {
      const api = getApiConfig(stateRefs.llmSettings)
      // try to set our recommended models if there isn't any default or anything!
      if (api && !api.selectedModel) {
        stateRefs.llmSettings.llmApis['taskyon']!.selectedModel = api.models?.free
      }
      void updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then(
        (m) => (llmModelsInternal.value = m),
      )
    },
    {
      immediate: true,
    },
  )

  const allowedLLMModels = computed<string[] | undefined>(() => {
    if (stateRefs.llmSettings.selectedApi === 'taskyon') {
      // if we have a taskyon key defined only display the models allowed for that key...
      if (stateRefs.tyPublicKey?.model && stateRefs.tyPublicKey.model.length > 0) {
        if (!stateRefs.tyPublicKey.model.includes('*')) {
          const models = stateRefs.tyPublicKey.model
          return models
        }
      }
    }
    return undefined
  })

  watch(
    [
      () => stateRefs.appConfiguration.primaryColor,
      () => stateRefs.appConfiguration.secondaryColor,
    ],
    ([primary, secondary]) => {
      console.log('Set new brand colors!!', primary, secondary)
      setColors(primary, secondary)
    },
  )

  // we are using refs here for selectedThread and currentTask isntead of a computed reference, because
  // we want to oad them gradually into our UI
  const taskWorkerWaiting = ref(true)
  const currentTask = ref<TaskNode | null>(null)
  const selectedThread = ref<TaskNode[]>([])
  const selectedThreadIDs = ref<string[]>([])

  // this needs to be a watch, because we're updating this variable from other sources as well...
  // TODO: make this a readonly property...
  watch(
    () => stateRefs.llmSettings.selectedTaskId,
    async (newSelectedTask) => {
      // TODO: I don't remember why we need this delay here....
      if (newSelectedTask) {
        const TM = await getTaskManager()
        currentTask.value = await TM.getTask(newSelectedTask)
        selectedThreadIDs.value = await TM.getTaskIdChain(newSelectedTask)
        selectedThread.value = await TM.convertTaskIDs(selectedThreadIDs.value)
      } else {
        currentTask.value = null
        selectedThread.value = []
        selectedThreadIDs.value = []
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

  // Computed property to determine the currently selected bot name
  const currentModelId = computed(() => {
    return getCurrentModel(stateRefs.llmSettings)
  })

  const currentModel = computed(() => {
    return llmModelsInternal.value[currentModelId.value]
  })

  // Method to handle the updateBotName event
  const handleBotNameUpdate = ({
    newName,
    newService,
  }: {
    newName: string
    newService?: string
  }) => {
    console.log('getting an api & bot update :)', newName, newService)
    if (newService) {
      stateRefs.llmSettings.selectedApi = newService
    }
    const api = getApiConfig(stateRefs.llmSettings)
    if (api) {
      api.selectedModel = newName
    }
    addModelToHistory(newName)
  }

  watch(
    () => $q.dark.isActive,
    (newState) => setPrismTheme(newState),
  )

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
    const tm = await getTaskManager()
    const meta = tm.debugDb.get(id)
    return meta
  }

  function getTaskMetaRef(taskId: string | undefined) {
    const taskMetaRef = ref<TaskNodeMeta>()
    let subscriptionUnsub: (() => void) | null = null
    if (taskId) {
      void getTaskManager().then((tm) => {
        subscriptionUnsub = tm.debugDb.readLive(taskId).subscribe(({ data }) => {
          taskMetaRef.value = data || undefined
        })
      })
    }
    onScopeDispose(() => {
      if (subscriptionUnsub) subscriptionUnsub()
    })
    return computed(() => taskMetaRef.value)
  }

  return {
    secretStore,
    getTaskMetaRef,
    getMeta,
    setNewContentDraft,
    setContentDraftFromTask,
    allTools: computed(() => allTools.value),
    switchTaskType,
    taskContentDraft,
    // TODO: add "value" just like with the other computed properties...
    selectedThread: computed(() => selectedThread),
    taskWorkerWaiting: computed(() => taskWorkerWaiting.value),
    currentTask: computed(() => currentTask),
    getOpenRouterPKCEKey,
    addModelToHistory,
    stopWorker,
    getTaskManager,
    lastTaskState,
    workerStreamLogs,
    addToProcessQueue,
    chatCompletionStream,
    llmModels: computed(() => llmModelsInternal.value),
    allowedLLMModels,
    currentModelId,
    currentModel,
    handleBotNameUpdate,
    connectMessageIframe,
    entryNode,
    api: iApiIn,
  }
}) // this state stores all information which
// should be stored e.g. in browser LocalStorage
