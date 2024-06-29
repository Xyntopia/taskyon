import { addTask2Tree, TyTaskManager } from './taskyon/taskManager';
import { TaskyonMessages, ToolBase, partialTaskDraft } from './taskyon/types';
import type { llmSettings } from './taskyon/chat';

/*function stringifyIfNotString(obj: unknown): string | undefined {
    if (typeof obj === 'undefined') return undefined;
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }*/

export function setupIframeApi(
  llmSettings: llmSettings,
  taskManager: TyTaskManager
) {
  console.log('Turn on iframe API.');
  // Listen for messages from the parent page
  window.addEventListener(
    'message',
    function (event: MessageEvent<TaskyonMessages>) {
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
              const newTask = {
                ...msg.data.task,
                content: msg.data.task.content,
              };
              void addTask2Tree(
                newTask,
                undefined,
                llmSettings,
                taskManager,
                false,
                false
              );
            } else if (msg.success && msg.data.type === 'functionDescription') {
              const newFunc = ToolBase.parse(msg.data);
              console.log(
                `functionDescription was sent by ${event.origin}`,
                newFunc
              );
              const newTask: partialTaskDraft = {
                role: 'system',
                content: {
                  message: JSON.stringify(newFunc),
                },
                label: ['function'],
              };
              void addTask2Tree(
                newTask,
                undefined,
                llmSettings,
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
