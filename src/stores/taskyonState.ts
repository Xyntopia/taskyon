import { defineStore } from 'pinia'
import { watch, computed, reactive, ref, type ComputedRef } from 'vue'
import {
  type Model,
  type TaskNode,
  llmSettings,
  partialTaskDraft,
  type storedSettings,
} from 'src/modules/taskyon/types'
import axios from 'axios' // TODO: replace with fetch
import { Notify, setCssVar } from 'quasar' // load dynamically! :)
import { sleep } from 'src/modules/utils'
import { useQuasar } from 'quasar'
import { useTaskWorkerController, getApiConfig } from 'src/modules/taskyon/taskWorker'
import { initTaskyon } from 'src/modules/taskyon/init'
import { availableModels } from 'src/modules/taskyon/chat'
import { setupIframeApi } from 'src/modules/taskyon/iframeApi'
import type { Tool } from 'src/modules/taskyon/tools'
import { tylog } from 'src/modules/logger'
import { processMarkdown } from 'src/modules/taskyon/taskUtils'
import { useAppStateStore } from './appState'
import type { TaskEvent } from 'src/modules/taskyon/taskManager'

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0]
    window.history.pushState({}, document.title, baseUrl)
  }
}

function asyncComputed<T>(getter: () => Promise<T>, initialValue: T): ComputedRef<T> {
  const state = ref<T>(initialValue)
  const evaluate = async () => {
    state.value = await getter()
  }
  watch(getter, evaluate, { immediate: true })
  return computed(() => state.value) // Wrap in computed for write protection
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

  function defineTyGuiTools(): Tool[] {
    return [
      {
        function: async ({ newPrompts }: { newPrompts: { [key: string]: string } }) => {
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
            return `It was not possible to add prompts for ${Object.keys(newPrompts)} to
  ${Object.keys(stateRefs.llmSettings.taskChatTemplates)}. Did you use the wrong 
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
  const initTaskyonPromise = initTaskyon(
    stateRefs.llmSettings,
    stateRefs.keys,
    taskWorkerController,
    stateRefs.logError,
    TaskList,
    defineTyGuiTools(),
  )

  type TaskyonInstance = Awaited<ReturnType<typeof initTaskyon>>

  // Access taskManagerInstance and addTask2Tree without redundant awaits
  const getTaskManager = async (): Promise<TaskyonInstance['taskManagerInstance']> => {
    const { taskManagerInstance } = await initTaskyonPromise
    return taskManagerInstance
  }

  // we are doing this here, so that we can use our addTask2Tree immediatly without
  // multiple awaits..
  const addTask2Tree = async (
    ...args: Parameters<TaskyonInstance['addTask2Tree']>
  ): ReturnType<TaskyonInstance['addTask2Tree']> => {
    const { addTask2Tree } = await initTaskyonPromise
    return await addTask2Tree(...args)
  }

  async function addTasks(taskList: partialTaskDraft[]) {
    let lastTaskId: string | undefined = undefined
    for (const task of taskList) {
      task.state = task.state ?? 'Completed' // Ensure state is set
      task.debugging = task.debugging ?? {} // Ensure state is set
      lastTaskId = await addTask2Tree(
        task as typeof task & {
          state: TaskNode['state']
          debugging: TaskNode['debugging']
        },
        lastTaskId, //parent
        false,
      )
    }
    return lastTaskId
  }

  async function addMdTasks(markdown?: string) {
    console.log('adding new Markdown tasks!!')
    if (markdown) {
      const taskList = processMarkdown(markdown)
      const lastTaskId = await addTasks(taskList)
      return lastTaskId
    }
    return undefined
    // TODO: optionally execute the last task...
  }

  const add2ChatHistory = async (task: TaskNode, msg: TaskEvent | 'existing') => {
    console.log('update task history!!', task.id, msg)

    if (msg === 'new' || msg === 'update') {
      const tm = await getTaskManager()
      // we need to make sure, that our task is not already
      // the "parent" of another task in that case we only want the leaf task which is already present...
      for (const taskId of stateRefs.chatHistory) {
        if ((await tm.getTask(taskId))?.parentID === task.id) return
      }
    } else if (msg === 'delete') {
      // Filter out the deleted task ID
      stateRefs.chatHistory = stateRefs.chatHistory.filter((t) => t !== task.id)
      return
    } else if (msg === 'deleteAll') {
      // Clear history
      stateRefs.chatHistory = []
      return
    }

    // Check if the task already exists in the history
    if (!stateRefs.chatHistory.includes(task.id)) {
      // Add the task to the front of the list if it doesn't exist
      stateRefs.chatHistory.unshift(task.id)
    }

    // Remove task.id if it exists, then unshift to front (avoids duplication)
    // we do this every time something gets added to the history
    // we are not doin this anymore, because it gets too confusing for poeple ;)
    /*stateRefs.chatHistory = [
      task.id,
      ...stateRefs.chatHistory.filter((t) => t !== task.id),
    ];*/

    // Remove any entries which are a parent of the current task (keeping only leaf IDs)
    stateRefs.chatHistory = stateRefs.chatHistory.filter((t) => t !== task.parentID)

    // Enforce a maximum size of 50
    if (stateRefs.chatHistory.length > 50) {
      stateRefs.chatHistory.length = 50 // Trims excess elements from the end
    }

    // and sort all tasks according to their timestamp :)
    // TODO: we can't do this right now, because the task timestamp is optional
    //       and we want to make sure to really include all tasks in the chathistory...
  }

  // update chatHistory on-the-fly whenever our taskmanager adds new tasks...
  getTaskManager().then((tm) => {
    // fill chatHistory with some initial values...
    /*tm.searchTasks({
      selector: {
        created_at: { $exists: true }, // Ensures 'created_at' field is present
      },
      sort: [{ created_at: 'desc' }],
      limit: 20,
    }).then((r) => {
      r.forEach((t) => add2ChatHistory(t, 'new'));
    });*/

    tm.subscribeToTaskChanges(add2ChatHistory)
  })

  // also update chat history if we switch between tasks...
  watch(
    () => stateRefs.llmSettings.selectedTaskId,
    async (selectedTask) => {
      const tm = await getTaskManager()
      if (selectedTask) {
        const taskNode = await tm.getTask(selectedTask)
        if (taskNode) add2ChatHistory(taskNode, 'existing')
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
  updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then((m) => (llmModelsInternal.value = m))
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
      updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then(
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
    void setupIframeApi(
      addTask2Tree,
      stateRefs.appConfiguration,
      stateRefs.llmSettings,
      stateRefs.keys,
    )
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
    // this needs to be a watch, because we're updating this variable from other sources as well...
    // TODO: make this a readonly property...
    watch(
      () => stateRefs.llmSettings.selectedTaskId,
      async () => {
        // TODO: I don't remember why we need this delay here....
        await sleep(100) // Simulating a delay
        taskWorkerWaiting.value = taskWorkerController.isWaiting()
      },
    )

    const currentTask = asyncComputed(async () => {
      if (stateRefs.llmSettings.selectedTaskId) {
        const TM = await getTaskManager()
        return await TM.getTask(stateRefs.llmSettings.selectedTaskId)
      }
      return undefined
    }, undefined)

    const selectedThread = asyncComputed(async () => {
      const taskId = stateRefs.llmSettings.selectedTaskId
      console.log('update task thread...', taskId)
      if (taskId) {
        const TM = await getTaskManager()
        const threadIDChain = await TM.getTaskIdChain(taskId)
        const thread = (await Promise.all(threadIDChain.map((tId) => TM.getTask(tId)))).filter(
          (t) => t,
        ) as TaskNode[]
        return thread
      }
      return []
    }, [] as TaskNode[])

    return {
      selectedThread,
      taskWorkerWaiting,
      currentTask,
    }
  }

  const { selectedThread, taskWorkerWaiting, currentTask } = useReactiveTasks()

  // also make sure, that we update the history with the currently selected chat when initializing...
  if (currentTask.value) void add2ChatHistory(currentTask.value, 'update')

  return {
    selectedThread,
    taskWorkerWaiting,
    currentTask,
    getOpenRouterPKCEKey,
    addModelToHistory,
    taskWorkerController,
    getTaskManager,
    modelLookUp,
    llmModels: computed(() => llmModelsInternal.value),
    logger,
    addTask2Tree,
    addMdTasks,
  }
}) // this state stores all information which
// should be stored e.g. in browser LocalStorage
