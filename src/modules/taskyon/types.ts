import type OpenAI from 'openai'
import { z } from 'zod'
import { deepCopy } from '../utils'
import { JSONSchema7 } from '../jsonSchema'

//type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequireSome<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

export type RequireDefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined>
}

export type RemoveUndefined<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: Exclude<T[P], undefined>
}

export const removeKeys = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>
}

export function removeUndefinedProperties<T extends object>(obj: T): RemoveUndefined<T, keyof T> {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        ;(acc as Record<string, unknown>)[key] = value
      }
      return acc
    },
    {} as Record<keyof T, unknown>,
  ) as RemoveUndefined<T, keyof T>
}

export class TaskProcessingError extends Error {
  details: Record<string, unknown> | undefined

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'TaskFollowUpError'
    this.details = details
  }
}

// TODO: the goal should be to slowly replace this state by the "result of the task"
//       E.g. when a task had an error, this would be represented in the task result as an "error"
const TaskState = z.enum(['Open', 'Queued', 'In Progress', 'Completed', 'Cancelled', 'Error'])
  .describe(`The task state indicates on what is happening with the task: for example
it shows whether a task flow is seen as "completed" or whether its waiting
to be further processed... E.g. there could be a task with no results, which stil counts as "completed"`)
export type TaskState = z.infer<typeof TaskState>

export const OpenAIMessage = z.object({
  content: z.string().nullish(),
  //finish_reason: z.enum(['length', 'function_call', 'tool_calls', 'stop', 'content_filter']),
  tool_calls: z
    .array(
      z.object({
        function: z.object({ arguments: z.string(), name: z.string() }),
        type: z.literal('function'),
        id: z.string(),
      }),
    )
    .optional(),
  name: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool', 'developer']),
}) // we are allowing additional properties here, because different providers sometimes returns additional properties
export type OpenAIMessage = z.infer<typeof OpenAIMessage>

// TODO: get rid of OpenAI dependency...
// we are defining a "minimal" subset of openai chatcompletion which we need to have in our
// our own app!
// TODO: combine this type here with the previous, duplicate ones we have declared!! (e.g. OpenAIMessage)
// we are removing properties which we don't need for our purposes but compare it with the
// official OpenAI API.
// TODO: move all of our OpenAI functionality into chatCompletionTool...
export const ChatResponseType = z.object({
  id: z.string().default('N/A'),
  model: z.string().default('N/A'),
  object: z.literal('chat.completion'),
  choices: z
    .array(
      z.object({
        message: OpenAIMessage,
        finish_reason: z.enum([
          'length',
          'tool_calls',
          'stop',
          'content_filter',
          'function_call',
          'cancelled',
        ]),
        logprobs: z.unknown().optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number(),
          audio_tokens: z.number(),
        })
        .partial()
        .optional(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number(),
          audio_tokens: z.number(),
          accepted_prediction_tokens: z.number(),
          rejected_prediction_tokens: z.number(),
        })
        .partial()
        .optional(),
    })
    .nullish()
    .optional(),
})
export type ChatResponseType = z.infer<typeof ChatResponseType>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function assertType<T>(value: T): void {
  // This function does nothing at runtime, but it enforces type checking at compile time.
}
// Use the function to trigger type checking
// This will cause TypeScript to report an error if the types don't match
//assertType<ChatResponseType>({} as SimplifyDeep<OpenAI.ChatCompletion>)
assertType<ChatResponseType>({} as OpenAI.ChatCompletion)

export interface OpenRouterGenerationInfo {
  id: string
  total_cost: number
  created_at: string // ISO 8601 date string
  model: string
  app_id: number
  streamed: boolean
  cancelled: boolean
  provider_name: string
  latency: number
  moderation_latency: null | number // can be null
  generation_time: number
  finish_reason: string
  tokens_prompt: number
  tokens_completion: number
  native_tokens_prompt: number
  native_tokens_completion: number
  num_media_prompt: null | number // can be null
  num_media_completion: null | number // can be null
  origin: string
  usage: number
}

const FunctionName = z.string().refine((val) => /^[a-zA-Z0-9_-]+$/.test(val), {
  error: ({ input }) => {
    const msg = typeof input === 'string' ? input : JSON.stringify(input)
    return `The function/tool name ${msg} contains illegal characters. It has to fulfill '^[a-zA-Z0-9_-]+$'`
  },
})
type FunctionName = z.infer<typeof FunctionName>

export const ToolBase = z.object({
  description: z.string().meta({
    description: 'A short description about the tool so that an LLM knows when to use it.',
  }),
  longDescription: z.string().optional().meta({
    description: 'An optional longer description for more complicated operations with this tool.',
  }),
  name: FunctionName.describe('Name of the tool. Has to fulfill: /^[a-zA-Z0-9_-]+$/'),
  renderOptions: z
    .object({
      hideChat: z
        .boolean()
        .describe(
          "hide the tool in the UI chat. Useful if the function is used very often and we don't want it to clutter the chatWindow",
        ),
      hideLlm: z.boolean(
        'HideLlm will hide the  tool from an LLM inside chatCompletion. This is mainly useful for tools like "chatCompletion" which the llm doesn\'t need to see in the chatCompletion.',
      ),
    })
    .partial()
    .optional(),
  parameters: JSONSchema7.describe(
    'A JSON schema object describing the parameters of the function.',
  ).readonly(),
  code: z
    .string()
    .optional()
    .describe(
      `The functionality of the tool as javascript code. If a function description doesn't include any code,
Taskyon will automatically call a postMessage event with the parameters to the parent window
with the function name.`,
    ),
})
export type ToolBase = z.infer<typeof ToolBase> // this reflects json schema:  https://json-schema.org/specification-links

export const ParamType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
  // We are also allowing undefined calls to the functions, even though this is not allowed in jsonschema.
  // But we are sometimes calling our functions manually and this way we can also call them without parameters.
  z.undefined(),
])
export type ParamType = z.infer<typeof ParamType>
export const FunctionArguments = z.record(z.string(), ParamType).meta({
  description: 'arguments of the function',
})
export type FunctionArguments = z.infer<typeof FunctionArguments>

/* here we are essentiall declaring the taskyon API */
export const FunctionCall = z.object({
  name: FunctionName,
  arguments: FunctionArguments,
})
export type FunctionCall = z.infer<typeof FunctionCall>

const MessageContent = z.object({ type: z.literal('message'), data: z.string() })
const StructuredContent = z.object({
  type: z.literal('structured'),
  data: z.unknown(),
})
const ToolCallContent = z.object({ type: z.literal('functioncall'), data: FunctionCall })
const UploadedFilesContent = z.object({
  type: z.literal('files'),
  data: z.array(z.string()),
})
const ToolResultContent = z.object({ type: z.literal('toolresult'), data: z.unknown() })
const ToolDefinition = z.object({ type: z.literal('tooldefinition'), data: ToolBase })
const ErrorContent = z.object({ type: z.literal('error'), data: z.string() }).meta({
  description: 'Gets created if any error occurs during task processing.',
})
const Return = z.object({ type: z.literal('return'), data: z.string() }).describe(
  `A Termination task always indicates the end of an autonomous task chat execution.
Every Leaf task which is not a Termination task can potentially continue to be executed...

We can indicate the reason for termination here as well...`,
)

// TODO: I am not sure, if we need this here...
const ChatCompletionContent = z.union([MessageContent, ToolResultContent, ErrorContent])
export type ChatCompletionContent = z.infer<typeof ChatCompletionContent>

export const TaskContent = z.union([
  MessageContent.strict(),
  ToolResultContent.strict(),
  ToolDefinition.strict(),
  ErrorContent.strict(),
  StructuredContent.strict(),
  ToolCallContent.strict(),
  // TODO: replace with a "context" function which can also be a link to a URL for example or maybe a search string for other tasks...
  //       we can declare function for a lot of these things this way :)
  UploadedFilesContent.strict(),
  Return.strict(),
])

export type TaskContent = z.infer<typeof TaskContent>

export const TaskNodeMeta = z
  .object({
    threadMessage: z.any().optional(), // Replace with the correct Zod schema if available
    promptTokens: z.number().optional(),
    resultTokens: z.number().optional(),
    taskTokens: z.number().optional(),
    estimatedTokens: z
      .object({
        resultTokens: z.number().optional(),
        taskCosts: z.number().optional(),
        functionTokens: z.number().optional(),
        promptTokens: z.number().optional(),
        singlePromptTokens: z.number().optional(),
      })
      .optional(),
    toolStreamArgsContent: z.record(z.string(), z.string()).optional(),
    streamContent: z.string().optional(),
    taskCosts: z.number().optional(),
    rawOutput: z.unknown().optional().meta({
      description:
        'We can optionally add some raw result data for debugging purposes, e.g. chatcompletion ...',
    }), // Replace with the correct Zod schema if available
    error: z.unknown().optional(),
    taskPrompt: z.record(z.string(), z.unknown()).optional().meta({
      description: 'add any prompts that were used for a task...',
    }),
  })
  .partial()

export type TaskNodeMeta = z.infer<typeof TaskNodeMeta>

export const TaskNode = z.object({
  // TODO: get rid of "role"  and put it into chatCompletion only...
  // we don't need it in the rest of the app, I think.. we might be able to indicate that a task was
  // "automatically" created by using a notation in "authorID" e.g. something like.
  // "pubKey:gen" if the task was automatically generated && pubKey if it wasn't
  // OR: we could simply check the parents & priors of tasks. if tasks have a parent, they were generated
  // by a function. user-generated message should not have a parent...
  role: z.enum(['system', 'user', 'assistant', 'function']),
  name: z.string().optional().describe('An optional name for the task'),
  content: TaskContent.describe(
    `This is the actual content of the task. This is the actual content which is process at each step.
For example this is, what an LLM would actually get to see. There are only a few different ways
of how content can be structured. `,
  ),
  label: z.array(z.string()).optional(),
  parentID: z.string().optional().meta({
    description: 'The ID of the parent task which created this subtask on a lower stack level',
  }),
  priorID: z.string().optional().describe('The ID of the previous task in the same stack level.'),
  // TODO: validate this ID using our content address creation functions
  id: z.string(),
  authorId: z.string().optional(),
  created_at: z.number().optional(),
  acl: z.string().array().optional()
    .describe(`A number of public keys which act as access control lists (ACL).
They are given certain as a list of public keys + type of ownership.
 ["pubkey:owner", "pubkey:editor1", "pubkey:editor2"]

 The value is optional. If no ACL is specified, the task is "public" and
 can for example be freely exchange in p2p settings.

TODO: define onwership types..`),
  sig: z.string().optional().meta({
    description:
      'A signature from the author of the Task. It is created from the entire content of the tasj except for the signature itself.',
  }),
})
export type TaskNode = z.infer<typeof TaskNode>

export const TaskListType = z.array(TaskNode)
export type TaskListType = z.infer<typeof TaskListType>

export type TaskGetter = (input: string) => Promise<TaskNode | null>

// TODO: get rid of taskDraft once we have immutable tasks with content addressing
//       once we have that, we can simply create tasks immediatly with the correct content address as an ID,
export const partialTaskDraft = TaskNode.omit({
  id: true,
  created_at: true,
  priorID: true,
  parentID: true,
})
  .partial()
  .required({ role: true, content: true })
  .meta({
    description:
      'This is just a subset of the task properties which can be used to define new tasks in various places.',
  })
export type partialTaskDraft = z.infer<typeof partialTaskDraft>

export const taskTemplateTypes = {
  toolDescription: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { type: 'message', data: 'Tool Description here!' },
      role: 'system',
      label: ['function'],
    }),
  file: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { type: 'files', data: [] },
      role: 'system',
      label: ['files'],
    }),
  /*file: partialTaskDraft.required({role: true, label: true})
  .merge(TaskNode['configuration']).default({
    role: 'system',
    configuration: {
      message: "test"
    },
    label: ['file']
  })*/
}

/*
TODO: for longer, autonomous agent processes & when errors happen, we might need this
TODO: if we want to create multiple tasks for a larger project, we should use schema like the following
      to create/refine tasks..
const yamlTaskSchema = yamlToolChatType.extend({
  thoughts: z.string(),
  reasoning: z.string(),
  plan: z.string().array(),
  criticism: z.string(),
});
type yamlTaskSchema = z.infer<typeof yamlTaskSchema>;
*/

interface Permission {
  id: string
  object: string
  created: number
  allow_create_engine: boolean
  allow_sampling: boolean
  allow_logprobs: boolean
  allow_search_indices: boolean
  allow_view: boolean
  allow_fine_tuning: boolean
  organization: string
  group: null | string
  is_blocking: boolean
}

type modalities = 'text' | 'image'

export interface Model {
  id: string
  name?: string
  description?: string
  context_length?: number
  object?: string
  created?: number
  owned_by?: string
  permission?: Permission[]
  root?: string
  parent?: null | string
  pricing?: {
    prompt: string
    completion: string
    image?: string
    request?: string
    web_search?: string
    internal_reasoning?: string
    input_cache_read?: string
    input_cache_write?: string
  }
  top_provider?: {
    max_completion_tokens: number | null
    context_length: number
    is_moderated: boolean
  }
  architecture?: {
    modality?: string
    input_modalities?: modalities[]
    output_modalities?: modalities[]
    tokenizer?: string
    instruct_type?: string | null
  }
  per_request_limits?: {
    prompt_tokens: string
    completion_tokens: string
  } | null
}

const apiConfig = z
  .object({
    name: z.string().describe('The name of the API.'),
    baseURL: z.string().describe('Base URL of the api.'),
    defaultModel: z.string().describe('the default model which should be used for this API.'),
    selectedModel: z.string().optional().describe('which model is currently selected.'),
    models: z
      .object({
        instruction: z.string(),
        chat: z.string(),
        free: z.string(),
      })
      .partial()
      .optional()
      .meta({
        description: 'Define default models for some tasks.',
      }),
    streamSupport: z.boolean().describe('Does the API support streaming?'),
    defaultHeaders: z.record(z.string(), z.string()).optional().meta({
      description: 'If the API needs some special headers for communication (e.g. an API key.)',
    }),
    routes: z.object({
      chatCompletion: z.string().describe('Endpoint for chatcompletion.'),
      models: z.string().describe('Endpoint for list of models.'),
    }),
  })
  .meta({
    description: 'Definition of an OpenAI Compatible API.',
  })
export type apiConfig = z.infer<typeof apiConfig>

export const llmSettings = z.object({
  userId: z.string().nullish().optional().meta({
    description:
      'a (public) cryptographic user id which is used to identify the user in different chats',
  }),
  secretPublicKey: z.string().nullish().optional().meta({
    description: 'A (public) cryptographic key which is used to encrypt secrets',
  }),
  selectedTaskId: z.string().optional().meta({
    description:
      'The currently selected conversation defined by the ID of its last node. The task chain is defined through each tasknodes parent IDs',
  }),
  enableOpenAiTools: z
    .boolean()
    .default(false)
    .describe(
      `Enable OpenAI function selection, This doesn't work for all models currently
and is mainly recommended for all openAI models.
Taskyon "native" mode is usually recommended as it is model agnostic.`,
    ),
  selectedApi: z.string().nullish().default('taskyon').meta({
    description: 'which of the defined APIs are we currently using?',
  }),
  llmApis: z.record(z.string(), apiConfig).default({}).meta({
    description: 'A list of OpenAI compatible API definitions.',
  }),
  siteUrl: z.string().default('https://taskyon.space').meta({
    description:
      'wha is the URL of this page?. This helps identifying Backends, where the request is coming from.',
  }),
  summaryModel: z.string().default('Xenova/distilbart-cnn-6-6').meta({
    description: 'Which model are we using for local summary?',
  }),
  vectorizationModel: z.string().default('Xenova/all-MiniLM-L6-v2').meta({
    description: 'Which model should be used for vectorization?',
  }),
  maxAutonomousTasks: z.number().default(3).meta({
    description:
      'Maximum number of tasks which are allowed to be performed autonomously before stopping.',
  }),
  taskTemplate: partialTaskDraft.optional().meta({
    description:
      'A task template which can be provided for new tasks (E.g. which model to use). This is important when embedding tasyon in another webpage.',
  }),
  enableToolChooser: z.boolean().default(true).meta({
    description:
      'Enable the standard tool chooser. This function enables taskyon to decide if and then which tool it should use for the task.',
  }),
  taskDraft: partialTaskDraft
    .default({
      role: 'user',
      content: {
        type: 'message',
        data: '',
      },
    })
    .meta({
      description:
        'The task which is currently drafted (This could for example be a simple message).',
    }),
  allowedTools: z.array(FunctionName),
  useBasePrompt: z.boolean().default(true).describe(`
  *Toggle the base prompt on/off.*

  This gives the AI instructions how to draw better graphics, math
  formulas and generally make the chat a little more fancy than just plain
  text. You can check/change the base prompt in the settings...`),
  tryUsingVisionModels: z.boolean().default(true).meta({
    description:
      'Toggle Vision ON/OFF. If a model supports vision, we will try to use that for uploaded images',
  }),
  taskChatTemplates: z
    .object({
      basePrompt: z.string().meta({
        description:
          'The base prompt. This should be used e.g. to set the behaviour of the AI. used as a "system" prompt.',
      }),
      instruction: z.string().describe('This prompt is used to make the AI follow instructions'),
      toolResult: z.string().meta({
        description:
          'This prompt is used to make the AI display tool results in a certain structured way.',
      }),
      task: z.string().meta({
        description: 'This prompt is used to explain to the AI what to do with a specific task.',
      }),
      evaluate: z.string().describe('This prompt is used to evaluate errors'),
      schemaReminder: z.string().meta({
        description: 'This prompt is used to enforce a specific schema as a response...',
      }),
      tools: z.string().describe('This prompt is used to give the AI a list of tools.'),
    })
    .meta({
      description:
        'These are the definitions of the prompts which are used in chats for different purposes.',
    }),
})
export type llmSettings = z.infer<typeof llmSettings>

const hexColorRegex = /^#([A-Fa-f0-9]{6})$/
const HexColor = z.string().superRefine((value, ctx) => {
  if (!hexColorRegex.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid hexadecimal color',
    })
  }
})
type HexColor = z.infer<typeof HexColor>

const appConfiguration = z.object({
  appConfigurationUrl: z.string().default('/taskyon_settings.json').meta({
    description: 'URL from which to load the initial app configuration',
  }),
  gdriveConfigurationFile: z.string().default('taskyon_settings.json').meta({
    description: 'gDrive fileid of the configuration',
  }),
  expertMode: z.boolean().default(false).meta({
    description: 'Turns on additional settings and configurations.',
  }),
  showCosts: z.boolean().default(false).describe('Shows the costs of API calls.'),
  gdriveDir: z.string().default('taskyon').meta({
    description: 'The default directory in gdrive, where taskyon saves its configuration.',
  }), // not sure, if we need this here?
  useEnterToSend: z.boolean().default(true).meta({
    description: 'Determines, if enter will automatically send a message or rather shift-enter',
  }),
  guiMode: z.enum(['auto', 'iframe', 'default']).default('auto').meta({
    description: 'Sets whether we want to have a minimalist chat or the full app',
  }),
  primaryColor: HexColor.describe('The primary color of taskyons color scheme.').optional().meta({
    description: 'Primary color for custom taskyon theming. This should be a dark color',
  }),
  secondaryColor: HexColor.describe('The secondary color of taskyons color scheme.')
    .optional()
    .meta({
      description:
        'Secondary color for custom taskyon theming. This color should be a bright color and contrast the primary color.',
    }),
})
export type appConfiguration = z.infer<typeof appConfiguration>

export const storedSettings = z.object({
  version: z.literal(11).meta({
    description:
      'whenever the schema of the settings change, this number will get changed as well...',
  }),
  appConfiguration,
  llmSettings,
  signatureOrKey: z.string().optional()
    .describe(`By specifying a signature it is possible to circumvent
usage of an API key. This way you can give your users access to taskyon with your own restrictions.`),
})
export type storedSettings = z.infer<typeof storedSettings>

export const tyPublicKeyDraft = z.object({
  name: z.string().describe('Name of the key.').optional(),
  maxc: z.number().describe('Maximum allowed credits in this key').optional(),
  cpi: z.number().describe('Credit refill per inteval'),
  rti: z.number().describe('Refill time interval in minutes'),
  model: z.string().array().describe('List of models which are allowed with this key.').optional(),
})

export type tyPublicKeyDraft = z.infer<typeof tyPublicKeyDraft>

export const tyPublicApiKeyObject = tyPublicKeyDraft.extend({
  iat: z.number().describe('Time at which the key was issued.'),
  auid: z.string().describe('anonymous User ID for billing purposes.'),
  v: z.number().describe('Key version'),
  iss: z.string().describe('The Issuer of the API key.'),
})
export function getApiConfig(llmSettings: llmSettings) {
  if (llmSettings.selectedApi) {
    return llmSettings.llmApis[llmSettings.selectedApi]
  }
}
export function getApiConfigCopy(llmSettings: llmSettings, apiName?: string) {
  const searchName = apiName || llmSettings.selectedApi
  if (searchName) {
    const api = llmSettings.llmApis[searchName]
    return deepCopy(api)
  }
}

export function getCurrentModel(llmSettings: llmSettings) {
  const api = getApiConfig(llmSettings)
  if (api) {
    const modelName =
      api.selectedModel || api.defaultModel || api.models?.free || 'No model selected!'
    return modelName
  }
  return 'No model selected!'
}

export interface TyTaskStreamData {
  info?: string
  task?: TaskNode | null | undefined
  taskId?: string | null | undefined
  // "all finished" means the task has been processes AND all its subtasks have been finished..
  stage:
    | 'in loop' // task is put it the loop in order to check if it has subtasks
    | 'processing' // means, the task enters the loop of processing
    | 'processed'
    | 'error'
    | 'waiting'
    | 'subtasks'
    | 'all finished'
    | 'aborted'
    | 'queued'
}

// takes an object and turns all of its functions into async...
export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : T[K]
}

//export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }
export type WithRequired<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: Exclude<T[P], undefined>
}
export const taskMarker = '*TY_TASKRESULT*'
//export const convertZodToJsonSchemaCached = lruCache(100)(zodToJsonSchema)
export const convertZodToJsonSchemaCached = z.toJSONSchema
