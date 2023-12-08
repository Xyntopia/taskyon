import { defineStore } from 'pinia';
import { defaultLLMSettings } from 'src/modules/chat';
import { ref, Ref } from 'vue';
import type { LLMTask } from 'src/modules/types';
import type { FunctionArguments } from 'src/modules/types';

export const useTaskyonStore = defineStore('taskyonState', () => {
  console.log('initialize taskyon');

  const initialState = {
    chatState: defaultLLMSettings(),
    appConfiguration: {
      supabase_url: '',
      supabase_anon_key: '',
      expertMode: false,
      showCosts: false,
    },
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

  function setDraftFunctionArgs(newValue: FunctionArguments) {
    if (stateRefs.taskDraft.value.context?.function) {
      stateRefs.taskDraft.value.context.function.arguments = newValue;
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
