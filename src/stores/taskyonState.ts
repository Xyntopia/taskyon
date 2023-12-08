import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/chat';
import { ref, Ref, watch } from 'vue';
import type { LLMTask } from 'src/modules/types';
import type { FunctionArguments } from 'src/modules/types';

export const useTaskyonStore = defineStore('taskyonState', () => {
  console.log('initialize taskyon');

  const llmSettings = defaultLLMSettings();

  const initialState = {
    chatState: llmSettings,
    appConfiguration: {
      supabase_url: '',
      supabase_anon_key: '',
      expertMode: false,
      showCosts: false,
    },
    // initialize keys with all available apis...
    keys: llmSettings.llmApis.reduce((keys, api) => {
      keys[api.name] = '';
      return keys;
    }, {} as Record<string, string>),
    appConfigurationUrl: '', // URL from which to load the app
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

  return { ...stateRefs, setDraftFunctionArgs };
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
