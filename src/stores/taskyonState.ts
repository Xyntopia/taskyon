import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/chat';
import { ref, Ref, watch } from 'vue';
import type { LLMTask } from 'src/modules/types';
import type { FunctionArguments } from 'src/modules/types';
import axios from 'axios';
import { Notify } from 'quasar';

function removeCodeFromUrl() {
  if (window.history.pushState) {
    const baseUrl = window.location.href.split('?')[0];
    window.history.pushState({}, document.title, baseUrl);
  }
}

export const useTaskyonStore = defineStore('taskyonState', () => {
  console.log('initialize taskyon');

  const llmSettings = defaultLLMSettings();

  const initialState = {
    // chatState & appConfiguration define the state of our app!
    // the rest of the state if eithr secret (keys) or
    chatState: llmSettings,
    appConfiguration: {
      supabase_url: '',
      supabase_anon_key: '',
      appConfigurationUrl: '/configuration.json', // URL from which to load the initial app configuration
      gdriveConfigurationFile: 'configuration.json', // gDrive fileid of the configuration
      expertMode: false,
      showCosts: false,
      gdriveDir: 'taskyon',
    },
    // initialize keys with all available apis...
    keys: llmSettings.llmApis.reduce((keys, api) => {
      keys[api.name] = '';
      return keys;
    }, {} as Record<string, string>),
    // app State which should be part of the configuration
    modelDetails: false,
    expandedTaskCreation: false,
    selectChatBotExpand: true,
    allowedToolsExpand: true,
    showTaskData: false,
    drawerOpen: true,
    drawerRight: false,
    taskDraft: {} as Partial<LLMTask>,
    draftParameters: {} as Record<string, FunctionArguments>,
    debugMessageExpand: {},
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

  // Create refs for each property and adjust the type assertion
  const stateRefs = Object.fromEntries(
    Object.entries(initialState).map(([key, value]) => [key, ref(value)])
  ) as { [K in keyof typeof initialState]: Ref<(typeof initialState)[K]> };

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

// this file can be replaced in kubernetes  using a configmap!
// that way we can configure our webapp even if its already compiled...
/*void axios.get('config.json').then((jsonconfig) => {
  // we only want to load the initial configuration the first time we are loading the page...
  if (store.initial) {
    console.log('load App Config', jsonconfig.data);
    store.$state = jsonconfig.data as typeof store.$state;
    store.initial = false;
  }
  store.updateApiUrl();
});*/
