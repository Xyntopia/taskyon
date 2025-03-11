import type { ToolBase, partialTaskDraft } from './types'
import type { llmSettings } from './types'
import { deepMergeReactive } from '../utils'
import { TaskyonMessages } from './iframeApiTypes'
import type { TyTaskManager } from './taskManager'

/*function stringifyIfNotString(obj: unknown): string | undefined {
    if (typeof obj === 'undefined') return undefined;
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }*/

export function setupIframeApi(
  taskManager: TyTaskManager,
  appConfiguration: Record<string, unknown>,
  llmSettings: llmSettings,
  keys: Record<string, string>,
) {
  console.log('Turn on iframe API.')
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
          console.log('Message from unknown origin:', event.origin, event)
          try {
            // we wrap every call to the API in a try clause in order to make sure it doesn't blow up ;)
            const msg = TaskyonMessages.safeParse(event.data)
            if (msg.success && msg.data.type === 'task') {
              console.log(`task was sent by ${event.origin}`, msg.data)
              const newTask = {
                ...msg.data.task,
                content: msg.data.task.content,
              }
              void taskManager
                .addPartialTask2Tree(newTask, undefined, undefined, false)
                .catch((err) => console.warn(err))
            } else if (msg.success && msg.data.type === 'configurationMessage') {
              const newConfig = msg.data.conf
              console.log('setting our configuration')
              if (newConfig.llmSettings) {
                // TODO: add an "update settings" function which can also handle
                //       side effects such as setting the taskDrafts etc...
                deepMergeReactive(llmSettings, newConfig.llmSettings, 'overwrite')

                deepMergeReactive(appConfiguration, newConfig.appConfiguration, 'overwrite')
              }
              // and also set a possible signature as the api key!
              if (llmSettings.selectedApi && newConfig.signatureOrKey) {
                // we only set the API key, if it was provided by the
                // parent app.
                const newKey = newConfig.signatureOrKey
                keys[llmSettings.selectedApi] = newKey
              }
            } else if (msg.success && msg.data.type === 'functionDescription') {
              const { id, duplicateTaskName, ...rest } = msg.data
              const newFunc: ToolBase = rest
              console.log(`functionDescription was sent by ${event.origin}`, newFunc)
              const newTask: partialTaskDraft = {
                role: 'system',
                name: id,
                content: {
                  type: 'message',
                  data: JSON.stringify(newFunc),
                },
                label: ['function'],
              }
              void taskManager
                .addPartialTask2Tree(newTask, undefined, undefined, duplicateTaskName)
                .catch((err) => console.warn(err))
            } else {
              // TODO: also add this as error, so that it gets thrown back to the parent
              console.error('could not convert message to task:', {
                msg,
                event,
              })
            }
          } catch (err) {
            // TODO: return this to the parent, in order to indicate any errors..
            console.error(err)
          }
        } else {
          console.error('Message not from parent window.')
        }
      }
    },
    false,
  )

  const readyMessage: TaskyonMessages = { type: 'taskyonReady' }
  window.parent.postMessage(readyMessage, '*')
}
