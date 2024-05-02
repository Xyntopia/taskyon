import { boot } from 'quasar/wrappers';
import { reactive } from 'vue';
import { TaskManager, addTask2Tree } from 'src/modules/taskyon/taskManager';
import { LLMTask, partialTaskDraft } from 'src/modules/taskyon/types';
import {
  createTaskyonDatabase,
  TaskyonDatabase,
} from 'src/modules/taskyon/rxdb';
import { taskWorker } from 'src/modules/taskyon/taskWorker';
import { useTaskyonStore } from 'src/stores/taskyonState';
import {
  executePythonScript,
  localVectorStoreSearch,
  createToolExampleTool,
  Tool,
} from 'src/modules/taskyon/tools';
import { executeJavaScript } from 'src/modules/tools/executeJavaScript';
import { ChatStateType } from 'src/modules/taskyon/chat';

// Singleton holder for TaskManager
let taskManagerInstance: TaskManager;
export const errors: string[] = [];

export function logError(message: string) {
  errors.push(message);
}

// Function to get or create the TaskManager instance
export async function getTaskManager() {
  const state = useTaskyonStore();

  if (!taskManagerInstance) {
    const ToolList = reactive<Tool[]>([
      executePythonScript,
      // TODO: add local context(task) search
      localVectorStoreSearch,
      executeJavaScript,
    ]);
    ToolList.push(
      createToolExampleTool(
        ToolList.reduce((p, c) => {
          p[c.name] = c;
          return p;
        }, {} as Record<string, Tool>)
      )
    );

    // we are creating a reactive map for our memory-based task databae
    // this ensures, that we receive upates for our task in our UI.
    const TaskList = reactive<Map<string, LLMTask>>(new Map());
    console.log('initializing taskyondb');
    let taskyonDBInstance: TaskyonDatabase | undefined = undefined;
    try {
      taskyonDBInstance = await createTaskyonDatabase('taskyondb');
    } catch (err) {
      console.log('could not initialize taskyonDB', err);
      logError(
        `could not initialize taskyonDB:\n ${JSON.stringify(err, null, 2)}`
      );
    }
    console.log('initializing task manager');
    taskManagerInstance = new TaskManager(
      TaskList,
      ToolList,
      taskyonDBInstance,
      state.chatState.vectorizationModel
    );
    console.log('finished initialization');
  }
  return taskManagerInstance;
}

function setupIframeApi(chatState: ChatStateType, taskManager: TaskManager) {
  console.log('Turn on iframe API.');
  // Listen for messages from the parent page
  window.addEventListener(
    'message',
    function (event: MessageEvent<{ task?: unknown; result?: unknown }>) {
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
          if ('task' in event.data) {
            const result = partialTaskDraft.strict().safeParse(event.data.task);
            if (result.success) {
              void addTask2Tree(result.data, undefined, chatState, taskManager);
            } else {
              console.log(
                'could not convert message to task:',
                result.error,
                event
              );
            }
          }
        } else {
          console.error('Message not from parent window.');
        }
      }
    },
    false
  );
}

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/boot-files
export default boot(async (/*{ app, router, ... }*/) => {
  const state = useTaskyonStore();
  const taskManagerRef = await getTaskManager();
  // keys are reactive here, so in theory, when they change, taskyon should automatically
  // pick up on this...
  console.log('starting taskyon worker');
  void taskWorker(
    state.chatState,
    taskManagerRef,
    state.keys,
    state.taskWorkerController
  );

  //  const $q = useQuasar();
  //if ($q.platform.within.iframe) {
    void setupIframeApi(state.chatState, taskManagerRef);
  //}
});
