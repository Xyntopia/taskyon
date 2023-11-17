import { defineStore } from 'pinia';
import { defaultTaskState } from 'src/modules/chat';
import { ref, reactive } from 'vue';
import { run } from 'src/modules/taskWorker';
import type { LLMTask } from 'src/modules/types';
import type { FunctionArguments } from 'src/modules/tools';
import { createTaskyonDatabase, TaskyonDatabase } from 'src/modules/rxdb';

//TODO: convert store into composition api
export const useTaskyonStore = defineStore('taskyonState', () => {
  console.log('initialize taskyon');

  let taskyonDB: TaskyonDatabase | undefined = undefined;

  const initialState = reactive({
    chatState: defaultTaskState(),
    expertMode: false,
    showCosts: false,
    modelDetails: false,
    selectChatBotExpand: true,
    allowedToolsExpand: false,
    showTaskData: false,
    drawerOpen: false,
    drawerRight: false,
    taskDraft: {} as Partial<LLMTask>,
    draftParameters: {} as Record<string, FunctionArguments>,
    debugMessageExpand: {},
    darkTheme: 'auto' as boolean | 'auto',
    messageDebug: {} as Record<string, boolean>, // whether message with ID should be open or not...
  });

  void createTaskyonDatabase('taskyondb').then((newDB) => {
    taskyonDB = newDB;
    void run(initialState.chatState, newDB);
  });

  async function getTaskyonDB(): Promise<TaskyonDatabase> {
    while (taskyonDB === undefined) {
      // Wait for a short period before checking again to avoid blocking the thread
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return taskyonDB;
  }

  return { getTaskyonDB, ...initialState };
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
