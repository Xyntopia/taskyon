import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/taskyon/chat';
import { ref, Ref, watch, computed } from 'vue';
import type { LLMTask } from 'src/modules/taskyon/types';
import type { FunctionArguments } from 'src/modules/taskyon/types';
import axios from 'axios';
import { LocalStorage, Notify } from 'quasar';
import { deepMerge, deepMergeReactive } from 'src/modules/taskyon/utils';
import { useQuasar } from 'quasar';

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

function setupIframeApi() {
  console.log('Turn on iframe API.');
  // Listen for messages from the parent page
  window.addEventListener(
    'message',
    function (event) {
      // Check if the iframe is not the top-level window
      if (window !== window.top) {
        // Check if the message is from the parent window
        if (event.source === window.parent) {
          // Optionally, check the origin if you know what it should be
          // For example, if you expect messages only from 'https://example.com'
          /*if (event.origin === 'https://example.com') {
          console.log('Request from parent:', event.data);
        } else {
          console.error('Message from unknown origin:', event.origin);
        }*/
          console.log('Message from unknown origin:', event.origin, event);
        } else {
          console.error('Message not from parent window.');
        }
      }
    },
    false
  );
}

export const useTaskyonStore = defineStore(storeName, () => {
  const $q = useQuasar();

  console.log('initialize taskyon');

  if ($q.platform.within.iframe) {
    setupIframeApi();
  }

  const llmSettings = defaultLLMSettings();

  const initialState = {
    // chatState is also part of the configuration we can store "somewhere else"
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

  const minimalGui = computed(() => {
    let mode = false;
    switch (stateRefs.appConfiguration.value.guiMode) {
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

  return {
    ...stateRefs,
    setDraftFunctionArgs,
    getOpenRouterPKCEKey,
    minimalGui,
  };
});
