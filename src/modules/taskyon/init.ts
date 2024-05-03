import { TaskManager, addTask2Tree } from './taskManager';
import { LLMTask, TaskyonMessages } from './types';
import { createTaskyonDatabase, TaskyonDatabase } from './rxdb';
import {
  TaskWorkerController,
  taskWorker as runTaskWorker,
} from './taskWorker';
import { executePythonScript, Tool } from './tools';
import { executeJavaScript } from '../tools/executeJavaScript';
import { ChatStateType } from './chat';

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
          try {
            // we wrap every call to the API in a try clause in order to make sure it doesn't blow up ;)
            const msg = TaskyonMessages.safeParse(event.data);
            if (msg.success && msg.data.type === 'task') {
              console.log(`task was sent by ${event.origin}`, msg.data);
              void addTask2Tree(
                msg.data.task,
                undefined,
                chatState,
                taskManager,
                false,
                false
              );
            } else {
              // TODO: also add this as error, so that it gets thrown back to the parent
              console.log('could not convert message to task:', msg, event);
            }
          } catch (err) {
            // TODO: return this to the parent, in order to indicate any errors..
            console.error(err);
          }
        } else {
          console.error('Message not from parent window.');
        }
      }
    },
    false
  );

  const readyMessage: TaskyonMessages = { type: 'taskyonReady' };
  window.parent.postMessage(readyMessage, '*');
}

export async function initTaskyon(
  chatState: ChatStateType,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController,
  logError: (message: string) => void,
  // we explicitly provide a tasklist here, this gives us the chance to provide a reactive
  // value in order to get updates to the list of tasks immediatly reflected in the UI.
  TaskList: Map<string, LLMTask>,
  withAPI = false
) {
  const ToolList: Tool[] = [
    executePythonScript,
    // TODO: add local context(task) search
    // localVectorStoreSearch,
    executeJavaScript,
  ];

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
  const taskManagerInstance = new TaskManager(
    TaskList,
    ToolList,
    taskyonDBInstance,
    chatState.vectorizationModel
  );
  console.log('finished taskManager initialization');

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker');
  void runTaskWorker(
    chatState,
    taskManagerInstance,
    apiKeys,
    taskWorkerController
  );

  if (withAPI) {
    void setupIframeApi(chatState, taskManagerInstance);
  }

  return taskManagerInstance;
}
