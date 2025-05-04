import { defineStore } from 'pinia'
import { watch, computed, ref } from 'vue'
import type { Asyncify, TyTaskStreamData } from 'src/modules/taskyon/types'
import {
  type Model,
  type TaskNode,
  getCurrentModel,
  llmSettings,
  type storedSettings,
} from 'src/modules/taskyon/types'
import axios from 'axios' // TODO: replace with fetch
import { Notify } from 'quasar' // load dynamically! :)
import { useQuasar } from 'quasar'
import { getApiConfig } from 'src/modules/taskyon/types'
import { initTaskyon } from 'src/modules/taskyon/init'
import { availableModels } from 'src/modules/taskyon/chat'
import { setupIframeApi } from 'src/modules/taskyon/iframeApi'
import type { InternalTool } from 'src/modules/taskyon/tools'
import { useAppStateStore } from './appState'
import { filter } from 'src/modules/frpBus'
import { initializeSessionWithPasskey } from 'src/modules/cryptoSession'
import { generateRsaOaepPair } from 'src/modules/crypto_webcrypto'
import { setColors } from 'src/boot/brand-colors'

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
function asyncProxy<T extends Record<keyof T, (...args: Parameters<T[keyof T]>) => unknown>>(
  initializer: () => Promise<T>,
) {
  const instance = initializer()

  return new Proxy(
    {},
    {
      get:
        (_, prop) =>
        (...args: Parameters<T[keyof T]>) =>
          instance.then((obj) => {
            const method = obj[prop as keyof T]
            if (!method)
              throw new Error(`Method ${String(prop)} does not exist on the target object`)
            return method(...args)
          }),
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
  llmSettings: storedSettings['llmSettings'],
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
      return []
    }
  } else {
    return []
  }
}

export const useTaskyonStore = defineStore('taskyonControl', () => {
  console.log('loading taskyon store!')

  const $q = useQuasar()

  // load our store with all the settings
  // we use this here to confgure out taskyon logic
  const stateRefs = useAppStateStore()

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
  const initTaskyonPromise = (async () =>
    await initTaskyon(
      stateRefs.llmSettings,
      stateRefs.keys,
      defineTyGuiTools(),
      async () => (await generateRsaOaepPair()).publicKey,
    ))()

  // Access taskManagerInstance and addTask2Tree without redundant awaits
  const getTaskManager = async () => (await initTaskyonPromise)['taskManagerInstance']

  void getTaskManager().then((tm) => {
    tm.secretStore.requestInfos.subscribe((requestInfo) => {
      if (requestInfo.type === 'sessionKey') {
        void initializeSessionWithPasskey('typassid', 'tysessionid')
      }
    })
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

  const llmModelsInternal = ref<Model[]>([])
  void updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then(
    (m) => (llmModelsInternal.value = m),
  )
  // make sure we update our model list whenever anything changes for our
  // endpoints...
  watch(
    [() => stateRefs.llmSettings.selectedApi, stateRefs.keys, stateRefs.llmSettings.llmApis],
    () => {
      const api = getApiConfig(stateRefs.llmSettings)
      // try to set our recommended models if ther isn't any default or anything!
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

  const modelLookUp = computed(() =>
    llmModelsInternal.value.reduce(
      (acc, m) => {
        acc[m.id] = m
        return acc
      },
      {} as Record<string, Model>,
    ),
  )

  // set up iframe API
  if ($q.platform.within.iframe) {
    void (async () => {
      const taskManager = await getTaskManager()
      void setupIframeApi(
        taskManager,
        stateRefs.appConfiguration,
        stateRefs.llmSettings,
        stateRefs.keys,
      )
    })()
  }

  watch(
    [
      () => stateRefs.appConfiguration.primaryColor,
      () => stateRefs.appConfiguration.secondaryColor,
    ],
    ([primary, secondary]) => {
      console.log('Set new brand colors!!', primary, secondary)
      setColors(primary, secondary)
    },
    {
      immediate: true,
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
    return modelLookUp.value[currentModelId.value]
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

  return {
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
    modelLookUp,
    chatCompletionStream,
    llmModels: computed(() => llmModelsInternal.value),
    currentModelId,
    currentModel,
    handleBotNameUpdate,
  }
}) // this state stores all information which
// should be stored e.g. in browser LocalStorage
