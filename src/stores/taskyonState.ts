import { defineStore } from 'pinia';
import { watch, computed, reactive, ref } from 'vue';
import {
  type Model,
  type TaskNode,
  llmSettings,
  type storedSettings,
} from 'src/modules/taskyon/types';
import axios from 'axios'; // TODO: replace with fetch
import { Notify, setCssVar } from 'quasar'; // load dynamically! :)
import { sleep } from 'src/modules/utils';
import { useQuasar } from 'quasar';
import {
  useTaskWorkerController,
  getApiConfig,
} from 'src/modules/taskyon/taskWorker';
import { initTaskyon } from 'src/modules/taskyon/init';
import { availableModels } from 'src/modules/taskyon/chat';
import { setupIframeApi } from 'src/modules/taskyon/iframeApi';
import type { Tool } from 'src/modules/taskyon/tools';
import { tylog } from 'src/modules/logger';
import { processMarkdown } from 'src/modules/taskyon/taskUtils';
import { useAppStateStore } from './appState';

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0];
    window.history.pushState({}, document.title, baseUrl);
  }
}

async function updateLlmModels(
  llmSettings: storedSettings['llmSettings'],
  keys: Record<string, string>,
) {
  console.log('downloading models...');
  const api = getApiConfig(llmSettings);
  if (api) {
    // and also get a "fresh" list of models from the server...
    let baseURL = api.baseURL + api.routes.models;
    let key = keys[api?.name] || '';
    const taskyonApi = llmSettings.llmApis['taskyon'];
    // we are doing this, because openrouter currently
    // blocks access from browser origins through CORS.
    if (taskyonApi && api.name === 'openrouter.ai') {
      baseURL = taskyonApi.baseURL + '/models_openrouter';
      key = keys.taskyon || keys[api?.name] || '';
    }
    try {
      const res = await availableModels(baseURL, key, api.defaultHeaders ?? {});
      return res;
    } catch {
      console.log("couldn't download models from", baseURL);
      return [];
    }
  } else {
    return [];
  }
}

export const useTaskyonStore = defineStore('taskyonControl', () => {
  console.log('loading taskyon store!');

  const $q = useQuasar();

  const errors: string[] = [];
  function logError(message: string) {
    errors.push(message);
  }
  function getErrors() {
    return errors;
  }

  const logger = tylog;

  // load our store with all the settings
  // we use this here to confgure out taskyon logic
  const stateRefs = useAppStateStore();

  watch(
    () => stateRefs.llmSettings.selectedApi,
    (newValue) => {
      console.log('api switch detected', newValue);
    },
  );

  let loadingKey = false;
  async function getOpenRouterPKCEKey(code: string) {
    if (loadingKey == false) {
      console.log('start openai PKCE');
      loadingKey = true;
      try {
        const response = await axios.post<{ key: string }>(
          'https://openrouter.ai/api/v1/auth/keys',
          {
            code: code,
          },
        );
        const data = response.data;
        console.log('downloaded key:', data.key);
        if (data.key) {
          Notify.create('API Key retrieved successfully');
          stateRefs.keys['openrouter.ai'] = data.key;
          stateRefs.llmSettings.selectedApi = 'openrouter.ai';
        } else {
          Notify.create('Failed to retrieve API Key');
        }
      } catch (error) {
        console.error('Error fetching API Key:', error);
        Notify.create('Error occurred while fetching API Key');
      }
      removeCodeFromUrl(); // Remove the 'code' from URL
      loadingKey = false;
    }
  }

  function defineTyGuiTools(): Tool[] {
    return [
      {
        function: async ({
          newPrompts,
        }: {
          newPrompts: { [key: string]: string };
        }) => {
          console.log('Modifying prompts in llmSettings...');
          const newPromptsMerged = {
            ...stateRefs.llmSettings.taskChatTemplates,
            ...newPrompts,
          };
          const result = llmSettings.shape.taskChatTemplates
            .strict()
            .safeParse(newPromptsMerged);
          if (result.success) {
            stateRefs.llmSettings.taskChatTemplates = result.data;
            console.log(
              'Prompts modified:',
              stateRefs.llmSettings.taskChatTemplates,
            );
          } else {
            return `It was not possible to add prompts for ${Object.keys(newPrompts)} to
  ${Object.keys(stateRefs.llmSettings.taskChatTemplates)}. Did you use the wrong 
  keys and are they all defined as string?`;
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
    ];
  }

  // TODO: don't add this taslist to tyManager, but subscribe to changes from tyManager in order to update it!!
  // last thing we do after having loaded all settings is to actually start taskyon! :)
  const TaskList = reactive(new Map<string, TaskNode>());
  // callin ExecutionContext.interrupt();  cancels processing of current task
  const taskWorkerController = useTaskWorkerController();
  console.log('initialize taskyon');
  const initPromise = initTaskyon(
    stateRefs.llmSettings,
    stateRefs.keys,
    taskWorkerController,
    logError,
    TaskList,
    defineTyGuiTools(),
  );

  type TaskyonInstance = Awaited<ReturnType<typeof initTaskyon>>;

  // Access taskManagerInstance and addTask2Tree without redundant awaits
  const getTaskManager = async (): Promise<
    TaskyonInstance['taskManagerInstance']
  > => {
    const { taskManagerInstance } = await initPromise;
    return taskManagerInstance;
  };

  // we are doing this here, so that we can use our addTask2Tree immediatly without
  // multiple awaits..
  const addTask2Tree = async (
    ...args: Parameters<TaskyonInstance['addTask2Tree']>
  ): ReturnType<TaskyonInstance['addTask2Tree']> => {
    const { addTask2Tree } = await initPromise;
    return await addTask2Tree(...args);
  };

  async function addMdTasks(markdown?: string, newTaskId?: string | undefined) {
    console.log('adding new Markdown tasks!!');
    if (markdown) {
      const taskList = processMarkdown(markdown);
      for (const task of taskList) {
        task.state = task.state ?? 'Completed'; // Ensure state is set
        task.debugging = task.debugging ?? {}; // Ensure state is set
        newTaskId = await addTask2Tree(
          task as typeof task & {
            state: TaskNode['state'];
            debugging: TaskNode['debugging'];
          },
          newTaskId, //parent
          false, // should we execute the task? // only the last one obviously ;)
        );
      }
      return newTaskId;
    }
    // TODO: optionally execute the last task...
  }

  const add2ChatHistory = async (task: TaskNode, msg: string) => {
    console.log('update task history!!', task.id, msg);

    if (msg === 'new' || msg === 'update') {
      const tm = await getTaskManager();
      // we need to make sure, that our task is not already
      // the "parent" of another task in that case we only want the leaf task which is already present...
      for (const taskId of stateRefs.chatHistory) {
        if ((await tm.getTask(taskId))?.parentID === task.id) return;
      }

      // Step 2: Remove task.id if it exists, then unshift to front (avoids duplication)
      stateRefs.chatHistory = [
        task.id,
        ...stateRefs.chatHistory.filter((t) => t !== task.id),
      ];

      // Step 1: Remove any entries which are a parent of the current task (keeping only leaf IDs)
      stateRefs.chatHistory = stateRefs.chatHistory.filter(
        (t) => t !== task.parentID,
      );

      // Step 3: Enforce a maximum size of 50
      if (stateRefs.chatHistory.length > 50) {
        stateRefs.chatHistory.length = 50; // Trims excess elements from the end
      }
    } else if (msg === 'delete') {
      // Filter out the deleted task ID
      stateRefs.chatHistory = stateRefs.chatHistory.filter(
        (t) => t !== task.id,
      );
    } else if (msg === 'deleteAll') {
      // Clear history
      stateRefs.chatHistory = [];
    }
  };

  // update chatHistory on-the-fly
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

    tm.subscribeToTaskChanges(add2ChatHistory);
  });

  function addModelToHistory(model: string) {
    if (stateRefs.modelHistory.length >= 5) {
      stateRefs.modelHistory.shift(); // remove oldest element
    }
    stateRefs.modelHistory.push(model);
  }

  const llmModelsInternal = ref<Model[]>([]);
  updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then(
    (m) => (llmModelsInternal.value = m),
  );
  // make sure we update our model list whenever anything changes for our
  // endpoints...
  watch(
    [
      () => stateRefs.llmSettings.selectedApi,
      stateRefs.keys,
      stateRefs.llmSettings.llmApis,
    ],
    () => {
      const api = getApiConfig(stateRefs.llmSettings);
      // try to set our recommended models if ther isn't any default or anything!
      if (api && !api.selectedModel) {
        stateRefs.llmSettings.llmApis['taskyon']!.selectedModel =
          api.models?.free;
      }
      updateLlmModels(stateRefs.llmSettings, stateRefs.keys).then(
        (m) => (llmModelsInternal.value = m),
      );
    },
    {
      immediate: true,
    },
  );

  const modelLookUp = computed(() =>
    llmModelsInternal.value.reduce(
      (acc, m) => {
        acc[m.id] = m;
        return acc;
      },
      {} as Record<string, Model>,
    ),
  );

  // set up iframe API
  if ($q.platform.within.iframe) {
    void setupIframeApi(
      addTask2Tree,
      stateRefs.appConfiguration,
      stateRefs.llmSettings,
      stateRefs.keys,
    );
  }

  watch(
    [
      () => stateRefs.appConfiguration.primaryColor,
      () => stateRefs.appConfiguration.secondaryColor,
    ],
    ([primary, secondary]) => {
      console.log('Set new brand colors!!', primary, secondary);
      if (primary) setCssVar('primary', primary);
      if (secondary) setCssVar('secondary', secondary);
    },
    {
      immediate: true,
    },
  );

  // TODO: adapt this to non-reactive tasks in tymanager
  function useReactiveTasks() {
    const selectedThread = ref<TaskNode[]>([]);
    const taskWorkerWaiting = ref(true);
    // TODO: have a current, reactive task here and update it using tymanager subscriptions...
    const currentTask = ref<TaskNode>();

    async function updateCurrentTask(taskId: string | undefined) {
      if (taskId) {
        currentTask.value = await (await getTaskManager()).getTask(taskId);
      }
      await sleep(100);
      taskWorkerWaiting.value = taskWorkerController.isWaiting();
    }
    void updateCurrentTask(stateRefs.llmSettings.selectedTaskId);
    watch(() => stateRefs.llmSettings.selectedTaskId, updateCurrentTask);

    async function updateTaskThread(taskId: string | undefined) {
      console.log('update task thread...', taskId);
      if (taskId) {
        const TM = await getTaskManager();
        const threadIDChain = await TM.getTaskIdChain(taskId);
        console.log('loading iniial thread chain');
        const thread = (await Promise.all(
          threadIDChain.map(async (tId) => {
            return await TM.getTask(tId);
          }),
        )) as TaskNode[];
        selectedThread.value = thread;
      } else {
        selectedThread.value = [];
      }
    }

    void updateTaskThread(stateRefs.llmSettings.selectedTaskId);
    watch(() => stateRefs.llmSettings.selectedTaskId, updateTaskThread);

    return {
      selectedThread,
      taskWorkerWaiting,
      currentTask,
    };
  }

  return {
    ...useReactiveTasks(),
    getOpenRouterPKCEKey,
    addModelToHistory,
    taskWorkerController,
    getTaskManager,
    logError,
    getErrors,
    modelLookUp,
    llmModels: computed(() => llmModelsInternal.value),
    logger,
    addTask2Tree,
    addMdTasks,
  };
}); // this state stores all information which
// should be stored e.g. in browser LocalStorage
