import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/taskyon/chat';
import { ref, Ref, watch } from 'vue';
import type { LLMTask } from 'src/modules/taskyon/types';
import type { FunctionArguments } from 'src/modules/taskyon/types';
import axios from 'axios';
import { Notify, LocalStorage } from 'quasar';
import { deepMerge, deepMergeReactive } from 'src/modules/taskyon/utils';
import {
  executePythonScript,
  localVectorStoreSearch,
  createToolExampleTool,
} from 'src/modules/taskyon/tools';
import { executeJavaScript } from 'src/modules/tools/executeJavaScript';


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
  console.log('initialize taskyon');

  const llmSettings = defaultLLMSettings();

  // initialize some of our default tools:
  llmSettings.tools = {
    executePythonScript,
    getToolExample: createToolExampleTool(llmSettings.tools),
    // TODO: add local context(task) search
    localVectorStoreSearch,
    executeJavaScript
  };

  const initialState = {
    chatState: llmSettings,
    appConfiguration: {
      supabase_url: '',
      supabase_anon_key: '',
      appConfigurationUrl: '/taskyon_settings.json', // URL from which to load the initial app configuration
      gdriveConfigurationFile: 'taskyon_settings.json', // gDrive fileid of the configuration
      expertMode: false,
      showCosts: false,
      gdriveDir: 'taskyon',
      useEnterToSend: true,
      enableTaskSettingsButton: true,
    },
    // chatState & appConfiguration define the state of our app!
    // the rest of the state is eithr secret (keys) or temporary states which don't need to be saved
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
    taskDraft: {} as Partial<LLMTask>,
    draftParameters: {} as Record<string, FunctionArguments>,
    taskState: {} as Record<string, TaskStateType>,
    darkTheme: 'auto' as boolean | 'auto',
    messageDebug: {} as Record<
      string,
      | 'RAW'
      | 'MESSAGECONTENT'
      | 'RAWTASK'
      | 'ERROR'
      | 'FOLLOWUPERROR'
      | undefined
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

  // Create refs for each property and adjust the type assertion
  const stateRefs = Object.fromEntries(
    Object.entries(storedInitialState).map(([key, value]) => [key, ref(value)])
  ) as { [K in keyof typeof initialState]: Ref<(typeof initialState)[K]> };

  if (stateRefs.initialLoad.value) {
    // this file can be replaced in kubernetes  using a configmap!
    // that way we can configure our webapp even if its already compiled...
    void axios
      .get(stateRefs.appConfiguration.value.appConfigurationUrl)
      .then((jsonconfig) => {
        // we only want to load the initial configuration the first time we are loading the page...
        console.log('load App Config', jsonconfig.data);
        const config = jsonconfig.data as {
          chatState: typeof initialState.chatState;
          appConfiguration: typeof initialState.appConfiguration;
        };
        deepMergeReactive(
          stateRefs.appConfiguration.value,
          config.appConfiguration
        );
        deepMergeReactive(stateRefs.chatState.value, config.chatState);
        stateRefs.initialLoad.value = false;
      });
  } else {
    console.log('loading previous configuration');
  }

  watch(
    () => stateRefs.chatState.value.selectedApi,
    (newValue) => {
      console.log('api switch detected', newValue);
    }
  );

  function setDraftFunctionArgs(newValue: FunctionArguments) {
    if (stateRefs.taskDraft.value.configuration?.function) {
      stateRefs.taskDraft.value.configuration.function.arguments = newValue;
    }
  }

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
          stateRefs.keys.value['openrouter.ai'] = data.key;
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

  return { ...stateRefs, setDraftFunctionArgs, getOpenRouterPKCEKey };
});
