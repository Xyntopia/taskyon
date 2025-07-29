import { ToolBase } from './types'
import type { llmSettings } from './types'
import { deepMergeReactive } from '../utils'
import { TaskyonMessage } from './apiTypes'
import type { TyTaskManager } from './taskManager'
import { match } from 'ts-pattern'
import { dump } from 'js-yaml'
import z from 'zod'
import type { Port } from '../frpBus'

/*function stringifyIfNotString(obj: unknown): string | undefined {
    if (typeof obj === 'undefined') return undefined;
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }*/

export const taskyonApi = (
  inPort: Port<TaskyonMessage>,
  taskManager: TyTaskManager,
  llmSettings: llmSettings,
  keys: Record<string, string>,
) => {
  inPort.receive((msg) => {
    try {
      // here we safe-guard against accidental messages on this bus...
      const res = TaskyonMessage.safeParse(msg)
      if (res.success) {
        match(res.data)
          .with({ type: 'task' }, (msg) => {
            void taskManager
              .addPartialTask2Tree(
                { ...msg.task, label: msg.origin ? [msg.origin] : undefined },
                undefined,
                undefined,
                false,
              )
              .catch((err: unknown) => console.warn(err))
          })
          .with({ type: 'functionDescription' }, (msg) => {
            const newFunc: ToolBase = msg
            console.log(`functionDescription was sent by ${msg.origin}`, newFunc)
            void taskManager.addDefaultTools([newFunc])
          })
          .with({ type: 'configurationMessage' }, (msg) => {
            const newConfig = msg.conf
            console.log('setting our configuration')
            if (newConfig.llmSettings) {
              // TODO: make sure, this function is only temporary and doesn't overwrite our actualy llmSettings...
              deepMergeReactive(llmSettings, newConfig.llmSettings, 'overwrite')
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
          })
        // we don't need "otherwise" here, because the other messages are currently handled by our
        // remotefunctionhandler
        // TODO:  BUT we want to chane this, and integrate the remote function handler with this API here as well...
      } else {
        console.error('could not convert message to task:', {
          res,
          event: msg,
        })
      }
    } catch (err) {
      // TODO: return this to the parent, in order to indicate any errors..
      console.error(err)
    }
  })
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
