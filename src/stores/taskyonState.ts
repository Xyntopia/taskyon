import { defineStore } from 'pinia';
import { watch, computed, reactive, toRefs, ref } from 'vue';
import type {
  ContentDraft,
  FunctionArguments,
  Model,
  LLMTask,
} from 'src/modules/taskyon/types';
import axios from 'axios'; // TODO: replace with fetch
import { LocalStorage, Notify } from 'quasar'; // load dynamically! :)
import { deepMerge, deepMergeReactive, sleep } from 'src/modules/taskyon/utils';
import { useQuasar } from 'quasar';
import { TaskWorkerController } from 'src/modules/taskyon/taskWorker';
import { initTaskyon } from 'src/modules/taskyon/init';
import defaultSettings from 'src/assets/taskyon_settings.json';
import {
  storedSettings,
  availableModels,
  getAssistants,
  getApiConfig,
} from 'src/modules/taskyon/chat';
import openrouterModules from 'assets/openrouter_models.json';
import openaiModels from 'assets/openai_models.json';

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
  console.log('loading taskyon store!');

  const $q = useQuasar();

  const errors: string[] = [];
  function logError(message: string) {
    errors.push(message);
  }
  function getErrors() {
    return errors;
  }

  const defaultStorableSettings = storedSettings.parse(defaultSettings);
  // llmSettings & appConfiguration define the state of our app!
  // the rest of the state is eithr secret (keys) or temporary states which don't need to be saved
  const initialState = {
    ...defaultStorableSettings,
    // initialize keys with all available apis...
    keys: Object.keys(defaultStorableSettings.llmSettings.llmApis).reduce(
      (keys, apiName) => {
        keys[apiName] = '';
        return keys;
      },
      {} as Record<string, string>
    ),
    // app State which should be part of the configuration
    // the things below should only represent transitional states
    // which have no relevance in the actual configuration of the app.
    initialLoad: true, // if the app was loaded for the first time and needs to be initialized
    modelDetails: false,
    expandedTaskCreation: false,
    selectChatBotExpand: true,
    allowedToolsExpand: true,
    showTaskData: false,
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
    // can be used to exchange certain keys and make taskyon
    // aware of different URLs etc...
    developerMode: false,
    messageDebug: {} as Record<
      string,
      'RAW' | 'MESSAGECONTENT' | 'RAWTASK' | 'ERROR' | undefined
    >, // whether message with ID should be open or not...
  };
  // this should be done intentionally by the user when visiting the first time!
  // initialState.keys['taskyon'] = 'anonymous';

  // overwrite with saved configuration:
  console.log(`load saved ${storeName} state!`);
  const storedStateString = LocalStorage.getItem(storeName) as string;
  const storedStateObj = JSON.parse(storedStateString) as
    | Partial<typeof initialState>
    | undefined;
  let stateRefs: typeof initialState;
  if (
    storedStateObj &&
    storedStateObj.version &&
    storedStateObj.version === initialState.version
  ) {
    console.log(`load saved ${storeName} state!`);
    const storedInitialState = deepMerge(
      initialState,
      storedStateObj,
      'overwrite'
    );
    stateRefs = reactive(storedInitialState);
  } else {
    console.warn(
      `Stored settings version (${
        storedStateObj?.version || 'undefined'
      }) is not compatible with current version (${
        initialState.version
      }). Using default settings.`
    );
    stateRefs = reactive(initialState);
  }

  // this file could potentially be replaced in kubernetes or docker using a configmap!
  // that way we can configure our webapp even if its already compiled...
  // this is done asynchrounously, because we want to be able to dynamically
  // change our config without having to recompile taskyon.
  void axios
    .get<
      | {
          version?: number;
          llmSettings: typeof initialState.llmSettings;
          appConfiguration: typeof initialState.appConfiguration;
        }
      | undefined
    >(stateRefs.appConfiguration.appConfigurationUrl)
    .then((jsonconfig) => {
      const config = jsonconfig.data;
      // TODO: we need to do much better parsing here...  possibly with zod to make sure
      //       we get back correct configuration versions etc..
      if (config) {
        const isVersionCompatible =
          config.version && config.version === initialState.version;

        if (isVersionCompatible) {
          // we only want to load the initial configuration the first time we are loading the page...
          console.log('merge dynamic app config', jsonconfig.data);

          const mergeStrategy = stateRefs.initialLoad
            ? 'overwrite'
            : 'additive';
          deepMergeReactive(
            stateRefs.appConfiguration,
            config.appConfiguration,
            mergeStrategy
          );
          deepMergeReactive(
            stateRefs.llmSettings,
            config.llmSettings,
            mergeStrategy
          );
        } else {
          console.warn(
            `Config version (${
              config.version || 'undefined'
            }) is not compatible with current version (${
              initialState.version
            }). Skipping dynamic config merge.`
          );
        }
        stateRefs.initialLoad = false;
      }
    })
    .catch((error) => {
      console.error('Failed to load dynamic app config:', error);
    });

  watch(
    () => stateRefs.llmSettings.selectedApi,
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
    stateRefs.llmSettings,
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

  const assistants = ref<Awaited<ReturnType<typeof getAssistants>>>({});
  const llmModels = ref<Model[]>([]);
  watch(
    () => stateRefs.llmSettings.selectedApi,
    () => {
      console.log('downloading models...');
      const api = getApiConfig(stateRefs.llmSettings);
      const taskyonApi = stateRefs.llmSettings.llmApis['taskyon'];
      if (api && taskyonApi) {
        llmModels.value =
          api.name === 'openai' ? openaiModels.data : openrouterModules.data;
        const baseurl =
          api.name === 'openrouter.ai'
            ? taskyonApi.baseURL + '/models_openrouter'
            : api.baseURL + api.routes.models;
        try {
          void availableModels(baseurl, stateRefs.keys.taskyon).then(
            (res) => (llmModels.value = res)
          );
        } catch {
          console.log("couldn't download models from", baseurl);
        }
      }
    },
    { immediate: true }
  );

  watch(
    () => stateRefs.llmSettings.useOpenAIAssistants,
    (newValue) => {
      if (newValue) {
        void getAssistants(stateRefs.keys.openai).then((assitantDict) => {
          assistants.value = assitantDict;
        });
      }
    }
  );

  const modelLookUp = computed(() =>
    llmModels.value.reduce((acc, m) => {
      acc[m.id] = m;
      return acc;
    }, {} as Record<string, Model>)
  );

  // we do this funny next line, because our store is currently "reactive" which means
  // all scalars like strings, numbers etc..  ar actually non-reactive (vue reactive only converts
  // nested objects into reactive as well). So by doing "toRefs" we ensure that all values are reactive
  // even after destructuring. The next issue is that typescript isn't able to recognize the type anymore when
  // we do the toRefs operation, so we simply reassign the same type "stateRefs" to it again which seems to work...
  const allRefs = toRefs(stateRefs) as unknown as typeof stateRefs;

  function $reset() {
    // this function doesn't 100% work.  each of the following
    // sould theoretically be enough to do the reset. But somehow they are not.
    // I assume it is some synchronization issue with localstorage.
    // But this is why we are trying several methods of deletion..
    console.log('Resetting Taskyon!!');
    stateRefs.appConfiguration = defaultStorableSettings.appConfiguration;
    stateRefs.llmSettings = defaultStorableSettings.llmSettings;
    LocalStorage.clear();
    stateRefs.version = 0 as typeof stateRefs.version; // set the version to 0, hoping, that this will trigger a reset on page reload..
    void sleep(1000).then(() => (window.location.href = '/'));
  }
  return {
    ...allRefs, // we need to convert everything into refs, as we have a reactive object which only turns
    $reset,
    getOpenRouterPKCEKey,
    addModelToHistory,
    minimalGui,
    taskWorkerController,
    getTaskManager,
    logError,
    getErrors,
    assistants,
    llmModels,
    modelLookUp,
  };
}); // this state stores all information which
// should be stored e.g. in browser LocalStorage
