import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/taskyon/chat';
import { watch, computed, reactive, toRefs } from 'vue';
import { LLMTask } from 'src/modules/taskyon/types';
import type {
  ContentDraft,
  FunctionArguments,
} from 'src/modules/taskyon/types';
import axios from 'axios';
import { LocalStorage, Notify } from 'quasar';
import { deepMerge, deepMergeReactive } from 'src/modules/taskyon/utils';
import { useQuasar } from 'quasar';
import { TaskWorkerController } from 'src/modules/taskyon/taskWorker';
import { initTaskyon } from 'src/modules/taskyon/init';

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0];
    window.history.pushState({}, document.title, baseUrl);
  }
}

const storeName = 'taskyonState';

interface TaskStateType {
  markdownEnabled: boolean;
}

export const useTaskyonStore = defineStore(storeName, () => {
  const $q = useQuasar();

  const errors: string[] = [];
  function logError(message: string) {
    errors.push(message);
  }
  function getErrors() {
    return errors;
  }

  const llmSettings = defaultLLMSettings();
  // chatState & appConfiguration define the state of our app!
  // the rest of the state is eithr secret (keys) or temporary states which don't need to be saved
  const initialState = {
    // chatState is also part of the configuration we can store "somewhere else"
    // TODO: rename chatState to llmSettings
    chatState: llmSettings,
    // appConfiguration is also part of the configuration we can store "somewhere else"
    appConfiguration: {
      supabase_url: '',
      supabase_anon_key: '',
      appConfigurationUrl: '/taskyon_settings.json', // URL from which to load the initial app configuration
      gdriveConfigurationFile: 'taskyon_settings.json', // gDrive fileid of the configuration
      expertMode: false,
      showCosts: false,
      gdriveDir: 'taskyon',
      useEnterToSend: true,
      // sets whether we want to have a minimalist chat or the full app..
      guiMode: 'auto' as 'auto' | 'iframe' | 'default',
    },
    // initialize keys with all available apis...
    keys: llmSettings.llmApis.reduce((keys, api) => {
      keys[api.name] = '';
      return keys;
    }, {} as Record<string, string>),
    // app State which should be part of the configuration
    // the things below should only represent transitional states
    // which have no relevance in the actual configuration of the app.
    initialLoad: true, // if the app was loaded for the first time and needs to be initialized
    modelDetails: false,
    expandedTaskCreation: false,
    selectChatBotExpand: true,
    allowedToolsExpand: true,
    showTaskData: false,
    drawerOpen: true,
    drawerRight: false,
    taskDraft: {} as Partial<LLMTask> & { content?: ContentDraft },
    modelHistory: [] as string[],
    newToolDraftCode: '' as string,
    draftParameters: {} as Record<string, FunctionArguments>,
    taskState: {} as Record<string, TaskStateType>,
    darkTheme: 'auto' as boolean | 'auto',
    // this store everything relevant to iframes
    iframe: {
      accessGranted: false,
      accessWhiteList: [] as string[],
      parentUrl: '',
    },
    messageDebug: {} as Record<
      string,
      'RAW' | 'MESSAGECONTENT' | 'RAWTASK' | 'ERROR' | undefined
    >, // whether message with ID should be open or not...
  };
  initialState.keys['taskyon'] = 'anonymous';

  // overwrite with saved configuration:
  console.log(`load ${storeName} state!`);
  const storedStateString = LocalStorage.getItem(storeName) as string;
  const storedStateObj = JSON.parse(storedStateString) as Partial<
    typeof initialState
  >;
  const storedInitialState = deepMerge(
    initialState,
    storedStateObj,
    'overwrite'
  );

  // manually make our state deep-reactive, becuase "reactive" doesn't make scalar values reactive :)
  // Create refs for each property and adjust the type assertion
  // Because of this, pini doesn't recognize the values as states.
  const stateRefs = reactive(storedInitialState);
  /*const stateRefs = Object.fromEntries(
    Object.entries(storedInitialState).map(([key, value]) => {
      return [key, typeof value === 'object' ? reactive(value) : ref(value)];
    })
  ) as { [K in keyof typeof initialState]: Ref<(typeof initialState)[K]> };*/

  if (stateRefs.initialLoad) {
    // this file can be replaced in kubernetes  using a configmap!
    // that way we can configure our webapp even if its already compiled...
    void axios
      .get(stateRefs.appConfiguration.appConfigurationUrl)
      .then((jsonconfig) => {
        // we only want to load the initial configuration the first time we are loading the page...
        console.log('load App Config', jsonconfig.data);
        const config = jsonconfig.data as {
          chatState: typeof initialState.chatState;
          appConfiguration: typeof initialState.appConfiguration;
        };
        deepMergeReactive(stateRefs.appConfiguration, config.appConfiguration);
        deepMergeReactive(stateRefs.chatState, config.chatState);
        stateRefs.initialLoad = false;
      });
  } else {
    console.log('loading previous configuration');
  }

  watch(
    () => stateRefs.chatState.selectedApi,
    (newValue) => {
      console.log('api switch detected', newValue);
    }
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
          }
        );
        const data = response.data;
        console.log('downloaded key:', data.key);
        if (data.key) {
          Notify.create('API Key retrieved successfully');
          stateRefs.keys['openrouter.ai'] = data.key;
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

  const minimalGui = computed(() => {
    let mode = false;
    switch (stateRefs.appConfiguration.guiMode) {
      case 'default':
        mode = false;
        break;
      case 'iframe':
        mode = true;
        break;
      case 'auto':
        mode = $q.platform.within.iframe;
        break;
    }
    return mode;
  });

  // last thing we do after having loaded all settings is to actually start taskyon! :)
  const TaskList = reactive<Map<string, LLMTask>>(new Map());
  // callin ExecutionContext.interrupt();  cancels processing of current task
  const taskWorkerController = new TaskWorkerController();
  console.log('initialize taskyon');
  const taskManager = initTaskyon(
    stateRefs.chatState,
    stateRefs.keys,
    taskWorkerController,
    logError,
    TaskList,
    $q.platform.within.iframe
  );
  async function getTaskManager() {
    return await taskManager;
  }

  function addModelToHistory(model: string) {
    if (stateRefs.modelHistory.length >= 5) {
      stateRefs.modelHistory.shift(); // remove oldest element
    }
    stateRefs.modelHistory.push(model);
  }

  // we do this funny next line, because our store is currently "reactive" which means
  // all scalars like strings, numbers etc..  ar actually non-reactive (vue reactive only converts
  // nested objects into reactive as well). So by doing "toRefs" we ensure that all values are reactive
  // even after destructuring. The next issue is that typescript isn't able to recognize the type anymore when
  // we do the toRefs operation, so we simply reassign the same type "stateRefs" to it again which seems to work...
  const allRefs = toRefs(stateRefs) as unknown as typeof stateRefs;
  return {
    ...allRefs, // we need to convert everything into refs, as we have a reactive object which only turns
    getOpenRouterPKCEKey,
    addModelToHistory,
    minimalGui,
    taskWorkerController,
    getTaskManager,
    logError,
    getErrors,
  };
});
