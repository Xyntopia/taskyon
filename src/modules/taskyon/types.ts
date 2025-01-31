import type OpenAI from 'openai'
import { z } from 'zod'
import { deepCopy } from '../utils'

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

export type OnInterruptFunc = (callback: (reason: string | null) => void) => void

// TODO: the goal should be to slowly replace this state by the "result of the task"
//       E.g. when a task had an error, this would be represented in the task result as an "error"
const TaskState = z.enum(['Open', 'Queued', 'In Progress', 'Completed', 'Cancelled', 'Error'])
  .describe(`The task state indicates on what is happening with the task: for example
it shows whether a task flow is seen as "completed" or whether its waiting
to be further processed... E.g. there could be a task with no results, which stil counts as "completed"`)
export type TaskState = z.infer<typeof TaskState>

const OpenAIMessage = z.object({
  content: z.string().nullable(),
  //finish_reason: z.enum(['length', 'function_call', 'tool_calls', 'stop', 'content_filter']),
  tool_calls: z
    .array(
      z.object({
        function: z.object({ arguments: z.string(), name: z.string() }),
        type: z.literal('function'),
      }),
    )
    .optional(),
  name: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'function', 'tool']),
  /*      logprobs: z
        .object({
          tokens: z.array(z.string()),
          token_logprobs: z.array(z.number().nullable()),
          top_logprobs: z.array(z.record(z.string(), z.number()).nullable()),
          text_offset: z.array(z.number()),
          content: z.string().optional(),
          refusal: z.string(), // Add required field
        })
        .nullable(),*/
})
export type OpenAIMessage = z.infer<typeof OpenAIMessage>

// TODO: get rid of OpenAI dependency...
// we are defining a "minimal" subset of openai chatcompletion which we need to have in our
// our own app!
// TODO: combine this type here with the previous, duplicate ones we have declared!! (e.g. OpenAIMessage)
// we are removing properties which we don't need for our purposes but compare it with the
// official OpenAI API.
// TODO: move all of our OpenAI functionality into chatCompletionTool...
export const ChatResponseType = z.object({
  id: z.string(),
  //object: z.string(),
  //created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      message: OpenAIMessage,
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
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

// in order to prevent a circular reference in zod, we need to define our JSONSchemaForFunctionParameter
// separately
// https://zod.dev/?id=recursive-types
// Base schema definition
// Base schema definition
const baseSchema = z.object({
  $schema: z.string().optional(),
  $id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']).optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  format: z.string().optional(),
  default: z.unknown().optional(),
})

// Define type separately and attach it to Zod
type JSONSchemaForFunctionParameter = z.infer<typeof baseSchema> & {
  properties?: Record<string, JSONSchemaForFunctionParameter> | undefined
  items?: JSONSchemaForFunctionParameter | JSONSchemaForFunctionParameter[] | undefined
}

const JSONSchemaForFunctionParameter: z.ZodType<JSONSchemaForFunctionParameter> = baseSchema.extend(
  {
    properties: z
      .record(
        z.string(),
        z.lazy(() => JSONSchemaForFunctionParameter),
      )
      .optional(),
    items: z
      .union([
        z.lazy(() => JSONSchemaForFunctionParameter),
        z.lazy(() => JSONSchemaForFunctionParameter.array()),
      ])
      .optional(),
  },
)

export const FunctionName = z
  .string()
  .refine(
    (val) => /^[a-zA-Z0-9_-]+$/.test(val),
    (val) => ({
      message: `The function/tool name ${val} contains illegal characters. It has to fulfill '^[a-zA-Z0-9_-]+$'`,
    }),
  )
  .describe('name of function')
export type FunctionName = z.infer<typeof FunctionName>

const renderOption = z.union([z.boolean(), z.function()])
export const ToolBase = z.object({
  description: z.string(),
  longDescription: z.string().optional(),
  name: FunctionName,
  renderOptions: z
    .object({ chatWindow: renderOption, llm: renderOption })
    .partial()
    .optional()
    .describe(
      `Provide a render function to render content the of this tool as text for an AI or
a chat window (e.g. an LLM). If we don't provide any render function, tools can still see all the information
and do somthing with it. But most tools will simply not render it for their purpose..
if render options aren't given taskyon chtcompletion function and chatwindow assumes them to be "true".
`,
    ),
  parameters: JSONSchemaForFunctionParameter,
  code: z
    .string()
    .optional()
    .describe(
      "If a function description doesn't include any code taskyon will call a postMessage to the parent window with the function name.",
    ),
})
export type ToolBase = z.infer<typeof ToolBase> // this reflects json schema:  https://json-schema.org/specification-links

export const ParamType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.null(),
])
export type ParamType = z.infer<typeof ParamType>
export const FunctionArguments = z.record(ParamType).describe('arguments of the function')
export type FunctionArguments = z.infer<typeof FunctionArguments>

/* here we are essentiall declaring the taskyon API */
export const FunctionCall = z.object({
  name: FunctionName,
  arguments: FunctionArguments,
})
export type FunctionCall = z.infer<typeof FunctionCall>

const MessageContent = z.object({ message: z.string() })
// TODO: get rid of structured content..  we should directly call a function task in order to interprete
//       structured content with the content as a parameter in order to decide what to do :)
const StructuredContent = z.object({ structuredResponse: z.string() })
const ToolCallContent = z.object({ functionCall: FunctionCall })
const UploadedFilesContent = z.object({ uploadedFiles: z.array(z.string()) })
const ToolResultContent = z.object({ toolResult: z.unknown() })
const ErrorContent = z
  .object({ error: z.unknown() })
  .describe('Gets created if any error occurs during task processing.')
const Termination = z.object({ termination: z.string() }).describe(
  `A Termination task always indicates the end of an autonomous task chat execution.
Every Leaf task which is not a Termination task can potentially continue to be executed...

We can indicate the reason for termination here as well...`,
)

// I am not sure, if we need this here...
const ChatCompletionContent = z.union([MessageContent, ToolResultContent, ErrorContent])
export type ChatCompletionContent = z.infer<typeof ChatCompletionContent>

const TaskContent = z.union([
  MessageContent.strict(),
  ToolResultContent.strict(),
  ErrorContent.strict(),
  StructuredContent.strict(),
  ToolCallContent.strict(),
  // TODO: replace with a "context" function which can also be a link to a URL for example or maybe a search string for other tasks...
  //       we can declare function for a lot of these things this way :)
  UploadedFilesContent.strict(),
  Termination.strict(),
])

export type TaskContent = z.infer<typeof TaskContent>

// TODO: add an "extended" task and put all information in there which we don't really "need"
//       to save in the database. E.g. how many follow-up tasks are allowed, how many
//       errors are allowed for function tasks  etc...  so mostly runtime-logic
export const TaskNode = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  name: z.string().optional(),
  content: TaskContent.describe(
    `This is the actual content of the task. This is the actual content which is process at each step.
For example this is, what an LLM would actually get to see. There are only a few different ways
of how content can be structured. `,
  ),
  label: z.array(z.string()).optional(),
  parentID: z
    .string()
    .optional()
    .describe('The ID of the parent task which created this subtask on a lower stack level'),
  priorID: z.string().optional().describe('The ID of the previous task in the same stack level.'),
  // provide debugging information about the task execution
  // all debugging information should be purely optional...
  // TODO: we should also include debugging information about the execution of the previous task
  //       here. The reason we're doing this, is, that we consider every Tasknode the "Result" of
  //       its previous/parent tas.
  debugging: z
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
      toolStreamArgsContent: z.record(z.string()).optional(),
      streamContent: z.string().optional(),
      taskCosts: z.number().optional(),
      rawInput: z.unknown().optional(), // Replace with the correct Zod schema if available
      error: z.unknown().optional(),
      // the taskprompt is the full chat which leads to the result. This is important that we have this
      // for to debugging reasons...
      // TODO:remove all openAI references hee nd move them into our chatCmpletion function...
      taskPrompt: z.union([z.array(OpenAIMessage), z.any()]).optional(), // Replace 'z.any()' with the correct Zod type
    })
    .partial(),
  id: z.string(), // can we make the id an SHA-1 value like in git? in that case we should simply remove this value...
  authorId: z.string().optional(),
  created_at: z.number().optional(),
})
export type TaskNode = z.infer<typeof TaskNode>

export const TaskListType = z.array(TaskNode)
export type TaskListType = z.infer<typeof TaskListType>

export type TaskGetter = (input: string) => Promise<TaskNode | undefined>

// TODO: get rid of taskDraft once we have immutable tasks with content addressing
//       once we have that, we can simply create tasks immediatly with the correct content address as an ID,
export const partialTaskDraft = TaskNode.omit({ id: true, created_at: true })
  .partial()
  .required({ role: true, content: true })
  .describe(
    'This is just a subset of the task properties which can be used to define new tasks in various places.',
  )
export type partialTaskDraft = z.infer<typeof partialTaskDraft>

export const taskTemplateTypes = {
  toolDescription: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { message: 'Tool Description here!' },
      role: 'system',
      label: ['function'],
    }),
  file: partialTaskDraft
    .required({ label: true })
    .merge(z.object({ role: z.literal('system') }))
    .default({
      content: { uploadedFiles: [] },
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
    discount?: number
    image?: string
    request?: string
  }
  top_provider?: {
    max_completion_tokens: number | null
  }
  architecture?: {
    modality?: string
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
      .describe('Define default models for some tasks.'),
    streamSupport: z.boolean().describe('Does the API support streaming?'),
    defaultHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe('If the API needs some special headers for communication (e.g. an API key.)'),
    routes: z.object({
      chatCompletion: z.string().describe('Endpoint for chatcompletion.'),
      models: z.string().describe('Endpoint for list of models.'),
    }),
  })
  .describe('Definition of an OpenAI Compatible API.')
export type apiConfig = z.infer<typeof apiConfig>

export const llmSettings = z.object({
  userId: z
    .string()
    .nullable()
    .optional()
    .describe('a cryptographic user id whic is used to identify the user in different chats'),
  selectedTaskId: z
    .string()
    .optional()
    .describe(
      'The currently selected conversation defined by the ID of its last node. The task chain is defined through each tasknodes parent IDs',
    ),
  enableOpenAiTools: z
    .boolean()
    .default(false)
    .describe('Enable OpenAI function selection, currently outdated.'),
  selectedApi: z
    .string()
    .nullable()
    .default('taskyon')
    .describe('which of the defined APIs are we currently using?'),
  llmApis: z.record(apiConfig).default({}).describe('A list of OpenAI compatible API definitions.'),
  siteUrl: z
    .string()
    .default('https://taskyon.space')
    .describe(
      'wha is the URL of this page?. This helps identifying Backends, where the request is coming from.',
    ),
  summaryModel: z
    .string()
    .default('Xenova/distilbart-cnn-6-6')
    .describe('Which model are we using for local summary?'),
  vectorizationModel: z
    .string()
    .default('Xenova/all-MiniLM-L6-v2')
    .describe('Which model should be used for vectorization?'),
  maxAutonomousTasks: z
    .number()
    .default(3)
    .describe(
      'Maximum number of tasks which are allowed to be performed autonomously before stopping.',
    ),
  taskTemplate: partialTaskDraft
    .deepPartial()
    .optional()
    .describe(
      'A task template which can be provided for new tasks (E.g. which model to use). This is important when embedding tasyon in another webpage.',
    ),
  taskDraft: partialTaskDraft
    .default({
      role: 'user',
      content: {
        message: '',
      },
    })
    .describe('The task which is currently drafted (This could for example be a simple message).'),
  allowedTools: z.array(FunctionName),
  useBasePrompt: z.boolean().default(true).describe(`
  <p>Toggle the base prompt on/off.</p>

  This gives the AI instructions how to draw better graphics, math
  formulas and generally make the chat a little more fancy than just plain
  text. You can check/change the base prompt in the settings...`),
  tryUsingVisionModels: z
    .boolean()
    .default(true)
    .describe(
      'Toggle Vision ON/OFF. If a model supports vision, we will try to use that for uploaded images',
    ),
  taskChatTemplates: z
    .object({
      basePrompt: z
        .string()
        .default(
          'The base prompt. This should be used e.g. to set the behaviour of the AI. used as a "system" prompt.',
        ),
      instruction: z.string().default('This prompt is used to make the AI follow instructions'),
      toolResult: z
        .string()
        .default(
          'This prompt is used to make the AI display tool results in a certain structured way.',
        ),
      task: z
        .string()
        .default('This prompt is used to explain to the AI what to do with a specific task.'),
      evaluate: z.string().default('This prompt is used to evaluate errors'),
      tools: z.string().default('This prompt is used to give the AI a list of tools.'),
    })
    .describe(
      'These are the definitions of the prompts which are used in chats for different purposes.',
    ),
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
  appConfigurationUrl: z
    .string()
    .default('/taskyon_settings.json')
    .describe('URL from which to load the initial app configuration'),
  gdriveConfigurationFile: z
    .string()
    .default('taskyon_settings.json')
    .describe('gDrive fileid of the configuration'),
  expertMode: z
    .boolean()
    .default(false)
    .describe('Turns on additional settings and configurations.'),
  showCosts: z.boolean().default(false).describe('Shows the costs of API calls.'),
  gdriveDir: z
    .string()
    .default('taskyon')
    .describe('The default directory in gdrive, where taskyon saves its configuration.'), // not sure, if we need this here?
  useEnterToSend: z
    .boolean()
    .default(true)
    .describe('Determines, if enter will automatically send a message or rather shift-enter'),
  guiMode: z
    .enum(['auto', 'iframe', 'default'])
    .default('auto')
    .describe('Sets whether we want to have a minimalist chat or the full app'),
  primaryColor: HexColor.describe('The primary color of taskyons color scheme.')
    .optional()
    .describe('Primary color for custom taskyon theming. This should be a dark color'),
  secondaryColor: HexColor.describe('The secondary color of taskyons color scheme.')
    .optional()
    .describe(
      'Secondary color for custom taskyon theming. This color should be a bright color and contrast the primary color.',
    ),
})
export type appConfiguration = z.infer<typeof appConfiguration>

export const storedSettings = z.object({
  version: z
    .literal(10)
    .describe(
      'whenever the schema of the settings change, this number will get changed as well...',
    ),
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
