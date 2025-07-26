import { ToolBase } from './types'
import type { llmSettings } from './types'
import { deepMergeReactive } from '../utils'
import { TaskyonMessage } from './iframeApiTypes'
import type { TyTaskManager } from './taskManager'
import { match } from 'ts-pattern'
import { dump } from 'js-yaml'
import z from 'zod'

/*function stringifyIfNotString(obj: unknown): string | undefined {
    if (typeof obj === 'undefined') return undefined;
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }*/

type TyMessage = MessageEvent<TaskyonMessage>

// TODO: instead of listening to messages through an event listener, we want
// to use a stream, so that we can use the same API for different message sources:
//  e.g. postMessage, websocket, REST API, p2p etc...
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
    function (event: TyMessage) {
      // Check if the iframe is not the top-level window
      // we are not using this currently, because its possible that the iframe is
      // embedded in another iframe, so we want to accept messages from the parent in any case.
      // if (window !== window.top) {
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
        // we wrap every call to the API in a try clause in order to make sure it doesn't blow up ;)
        try {
          // make sure, our message conforms to ty
          const res = TaskyonMessage.safeParse(event.data)
          if (res.success) {
            match(res.data)
              .with({ type: 'task' }, addNewTask(event, taskManager))
              .with({ type: 'functionDescription' }, addNewFunctionDescription(event, taskManager))
              .with(
                { type: 'configurationMessage' },
                setConfiguration(llmSettings, appConfiguration, keys),
              )
            // we don't need "otherwise" here, because the other messages are currently handled by our
            // remotefunctionhandler
            // TODO:  BUT we want to chane this, and integrate the remote function handler with this API here as well...
          } else {
            console.error('could not convert message to task:', {
              res,
              event,
            })
          }
        } catch (err) {
          // TODO: return this to the parent, in order to indicate any errors..
          console.error(err)
        }
      }
      // we only use this for debugging purposes, so we can see if any messages
      /*else {
        console.error('Message not from parent window.')
      }*/
    },
    false,
  )

  const readyMessage: TaskyonMessage = { type: 'taskyonReady' }
  window.parent.postMessage(readyMessage, '*')
}

function addNewTask(event: TyMessage, taskManager: TyTaskManager) {
  return (msg: Extract<TaskyonMessage, { type: 'task' }>) => {
    console.log(`task was sent by ${event.origin}`, msg.task)
    void taskManager
      .addPartialTask2Tree({ ...msg.task, label: [event.origin] }, undefined, undefined, false)
      .catch((err: unknown) => console.warn(err))
  }
}

function addNewFunctionDescription(event: TyMessage, taskManager: TyTaskManager) {
  return (msg: Extract<TaskyonMessage, { type: 'functionDescription' }>) => {
    const newFunc: ToolBase = msg
    console.log(`functionDescription was sent by ${event.origin}`, newFunc)
    void taskManager.addDefaultTools([newFunc])
  }
}

function setConfiguration(
  llmSettings: llmSettings,
  appConfiguration: Record<string, unknown>,
  keys: Record<string, string>,
) {
  return (msg: Extract<TaskyonMessage, { type: 'configurationMessage' }>) => {
    const newConfig = msg.conf
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
      if (typeof newKey === 'string') {
        keys[llmSettings.selectedApi] = newKey
      } else {
        console.warn('Provided signatureOrKey is not a string:', newKey)
      }
    }
  }
}

export function createOpenAPIDocs() {
  /** This function creates openAPI docs for taskyon and saves them inside the public folder.
   *  the reason we're doing this her as msot clients will simply want to get the json and
   * not have to run the entire taskyon app in order to generate the docs...
   */
  // make sure to validate this using https://editor.swagger.io/

  /*const docs = new OpenApiGeneratorV3(registry.definitions).generateDocument(
    config,
  );*/

  console.log('generate docs...')

  const schemas = [ToolBase, TaskyonMessage].map((zType) =>
    z.toJSONSchema(zType, { unrepresentable: 'any' }),
  )

  const openapiDoc = {
    openapi: '3.0.0',
    info: {
      title: 'Taskyon API',
      version: '1.0.0', // you can pull this from your package.json
      description: 'Auto‑generated schema for Taskyon postmessage/iframe API',
    },
    paths: {}, // add path defs here if you have any
    components: {
      schemas,
    },
  }

  const openApiYaml = dump(openapiDoc)

  /*const destPath = path.resolve(__dirname, 'public/docs/openapi-docs.yml')
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, openApiYaml, { encoding: 'utf-8' })*/

  //console.log(`OpenAPI docs written to ${destPath}`)
  return openApiYaml
}
