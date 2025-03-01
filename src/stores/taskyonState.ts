import { defineStore } from 'pinia'
import { watch, computed, reactive, ref } from 'vue'
import type { Asyncify } from 'src/modules/taskyon/types'
import {
  type Model,
  type TaskNode,
  llmSettings,
  type storedSettings,
} from 'src/modules/taskyon/types'
import axios from 'axios' // TODO: replace with fetch
import { Notify, setCssVar } from 'quasar' // load dynamically! :)
import { useQuasar } from 'quasar'
import { useTaskWorkerController } from 'src/modules/taskyon/taskWorker'
import { getApiConfig } from 'src/modules/taskyon/types'
import { initTaskyon } from 'src/modules/taskyon/init'
import { availableModels } from 'src/modules/taskyon/chat'
import { setupIframeApi } from 'src/modules/taskyon/iframeApi'
import type { InternalTool } from 'src/modules/taskyon/tools'
import { tylog } from 'src/modules/logger'
import { useAppStateStore } from './appState'
import type OpenAI from 'openai'
import { useCallbacks } from 'src/modules/useCallBacks'
import { filter } from 'src/modules/frpBus'

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

  const logger = tylog

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

  // TODO: don't add this taslist to tyManager, but subscribe to changes from tyManager in order to update it!!
  // last thing we do after having loaded all settings is to actually start taskyon! :)
  const TaskList = reactive(new Map<string, TaskNode>())
  // callin ExecutionContext.interrupt();  cancels processing of current task
  const taskWorkerController = useTaskWorkerController()
  console.log('initialize taskyon')

  const { triggerGlobal, removeGlobal, addGlobal } = useCallbacks<{
    taskId: string
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined
  }>()

  const initTaskyonPromise = initTaskyon(
    stateRefs.llmSettings,
    stateRefs.keys,
    taskWorkerController,
    stateRefs.logError,
    TaskList,
    defineTyGuiTools(),
    // this here is used as a callback for streaming..  all streaming chat completions call this function
    // together with the ID of the chatCompletion task.
    (id: string, chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined) => {
      triggerGlobal({ taskId: id, chunk })
    },
  )

  // Access taskManagerInstance and addTask2Tree without redundant awaits
  const getTaskManager = async () => (await initTaskyonPromise)['taskManagerInstance']

  // TODO: use the proxies below to replae the "getTaskmanager" and all of that..
  /*const taskManager = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['taskManagerInstance']
  })*/

  async function addToProcessQueue(taskId: string) {
    ;(await initTaskyonPromise).processTasksQueue.push(taskId)
  }

  const workerStream = asyncProxy(async () => {
    const instance = await initTaskyonPromise
    return instance['workerStream']
  })

  filter(
    workerStream,
    (data) => data.stage === 'processing' || data.stage === 'processed',
  ).subscribe((data) => {
    // TODO: add last task to GUI by checking if our current selected task now has this child...
    stateRefs.llmSettings.selectedTaskId = data.task?.id
  })

  void workerStream.subscribe((data) => {
    if (data.stage === 'waiting') taskWorkerWaiting.value = true
    else if (data.stage === 'processing') taskWorkerWaiting.value = false
  })

  void getTaskManager().then((tm) => {
    tm.taskStream.subscribe(({ id, data: task }) => {
      if (!task) {
        void add2ChatHistory(task, id.toString(), 'delete')
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
    } else if (msg === 'update') {
      const tm = await getTaskManager()
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
    stateRefs.chatHistory = stateRefs.chatHistory.filter(
      //(t) => t !== task.priorID && t !== task.parentID && !selectedThreadIDs.value.includes(t),
      (t) => t !== task.priorID && t !== task.parentID,
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
      if (primary) setCssVar('primary', primary)
      if (secondary) setCssVar('secondary', secondary)
    },
    {
      immediate: true,
    },
  )

  // TODO: adapt this to non-reactive tasks in tymanager
  function useReactiveTasks() {
    // we are using refs here for selectedThread and currentTask isntead of a computed reference, because
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
    )

    return {
      selectedThreadIDs,
      selectedThread,
      taskWorkerWaiting,
      currentTask,
    }
  }

  const { selectedThread, taskWorkerWaiting, currentTask } = useReactiveTasks()

  // also make sure, that we update the history with the currently selected chat when initializing...
  // TODO: this here is a porblem, because "currentTask" gets updated asynchrouously..
  watch(
    currentTask,
    (newValue) => {
      if (newValue) void add2ChatHistory(newValue, newValue.id, 'update')
    },
    { once: true },
  )

  return {
    selectedThread,
    taskWorkerWaiting,
    currentTask,
    getOpenRouterPKCEKey,
    addModelToHistory,
    taskWorkerController,
    getTaskManager,
    addToProcessQueue,
    modelLookUp,
    llmModels: computed(() => llmModelsInternal.value),
    logger,
    streamCallBacks: {
      removeGlobal,
      addGlobal,
    },
  }
}) // this state stores all information which
// should be stored e.g. in browser LocalStorage
