import type OpenAI from 'openai'
import { z } from 'zod'
import { deepCopy } from '../utils'
import {
  mdiAlphabeticalVariant,
  mdiAutoFix,
  mdiFunctionVariant,
  mdiProfessionalHexagon,
  mdiTools,
} from '@quasar/extras/mdi-v6'
import {
  matKeyboardReturn,
  matSmartToy,
  matVisibility,
  matVisibilityOff,
} from '@quasar/extras/material-icons'
import { assertType, type Expand } from '@taskyon/taskyon'
import { partialTaskDraft, type TaskNode } from '@taskyon/taskyon'

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
        reasoning: z.string().optional(),
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

// Now pull out the tooldefinition variant and fully expand it:
/*type ToolDefinitionNode = ExpandRecursively<
  Omit<TaskNode, 'content'> & {
    content: Extract<TaskNode['content'], { type: 'tooldefinition' }>
  }
>*/

/*type ToolDefinitionNode = TaskNode extends { content: infer C }
  ? C extends { type: 'tooldefinition' }
    ? Expand<Omit<TaskNode, 'content'> & { content: C }>
    : never
  : never*/

// 2. Generic extractor by content.type
export type TaskNodeType<K extends TaskNode['content']['type']> = TaskNode extends {
  content: infer C
}
  ? C extends { type: K }
    ? Expand<Omit<TaskNode, 'content'> & { content: C }>
    : never
  : never
/*
// 3. Example usages
type ToolDefNode    = TaskNodeType<"tooldefinition">
type MessageNode    = TaskNodeType<"message">
type ToolResultNode = TaskNodeType<"toolresult">
*/

export type TaskGetter = (input: string) => Promise<TaskNode | null>

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

// ────────────────────────── leaf enums & helpers ──────────────────────────
export type IOmodality = 'text' | 'image' | 'file'

export type SupportedParameter =
  | 'max_tokens'
  | 'temperature'
  | 'top_p'
  | 'tools'
  | 'tool_choice'
  | 'reasoning'
  | 'include_reasoning'
  | 'stop'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'repetition_penalty'
  | 'response_format'
  | 'top_k'
  | 'top_a'
  | 'top_logprobs'
  | 'logprobs'
  | 'logit_bias'
  | 'seed'
  | 'min_p'
  | 'structured_outputs'
  | 'web_search_options'

/** pricing quoted as *USD per–token* strings to avoid FP rounding */
export interface Pricing {
  prompt: string
  completion: string
  image?: string
  request?: string
  web_search?: string
  internal_reasoning?: string
  input_cache_read?: string
  input_cache_write?: string
}

export interface Architecture {
  /** e.g. `"text->text"` or `"text+image->text"` */
  modality?: string
  input_modalities?: IOmodality[]
  output_modalities?: IOmodality[]
  tokenizer?: string
  instruct_type?: string | null
}

export interface TopProvider {
  context_length: number
  max_completion_tokens: number | null
  is_moderated: boolean
}

// ───────────────────────────────── Model ──────────────────────────────────
export interface Model {
  /** primary identifier */ id: string
  /** canonical OpenRouter slug */ canonical_slug?: string // ← new :contentReference[oaicite:2]{index=2}
  hugging_face_id?: string | null
  name?: string
  description?: string
  context_length?: number
  created?: number

  architecture?: Architecture
  pricing?: Pricing
  top_provider?: TopProvider

  per_request_limits?: { prompt_tokens: string; completion_tokens: string } | null
  supported_parameters?: SupportedParameter[] // ← new :contentReference[oaicite:3]{index=3}

  // ── legacy OpenAI‑style fields (present in older APIs, harmless here) ──
  object?: string
  owned_by?: string
  permission?: Permission[]
  root?: string
  parent?: string | null
}

const apiConfig = z
  .object({
    name: z.string().meta({
      description: 'The name of the API.',
    }),
    baseURL: z.string().meta({
      description: 'Base URL of the api.',
    }),
    defaultModel: z.string().meta({
      description: 'the default model which should be used for this API.',
    }),
    selectedModel: z.string().optional().meta({
      description: 'which model is currently selected.',
    }),
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
    streamSupport: z.boolean().meta({
      description: 'Does the API support streaming?',
    }),
    defaultHeaders: z.record(z.string(), z.string()).optional().meta({
      description: 'If the API needs some special headers for communication (e.g. an API key.)',
    }),
    routes: z.object({
      chatCompletion: z.string().meta({
        description: 'Endpoint for chatcompletion.',
      }),
      models: z.string().meta({
        description: 'Endpoint for list of models.',
      }),
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
    .meta({
      onIcon: matSmartToy,
      offIcon: 'svguse:/taskyon_mono_opt.svg#taskyon',
      icon: mdiFunctionVariant,
      label: 'Native Agent Tools',
      description: `### Enable native AI function selection.

If this is enabled Taskyon will try to
leverage the native tool selection functionality of AI models.
Turning this off is usually recommended in order to use Taskyons model-agnostic mechanisms.

This doesn't work for all models currently and is mainly recommended for all openAI models.

For more information check this link: https://platform.openai.com/docs/guides/function-calling`,
    }),
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
  entryNode: partialTaskDraft.optional().meta({
    description: `A task template which is used as an entry node for taskyon.
When a user starts a conversation, this is always the first task that is called.

If none is specified, the "chooseTool" tool is used for tool calls and
simple chatCompletion for non-tool calls.
`,
  }),
  enableToolChooser: z.boolean().default(true).meta({
    description:
      'Enable the standard tool chooser. This function enables taskyon to decide if and then which tool it should use for the task.',
    icon: mdiTools,
    label: 'Use Tools',
  }),
  useBasePrompt: z
    .boolean()
    .default(true)
    .meta({
      offIcon: mdiAlphabeticalVariant,
      icon: mdiAutoFix,
      label: 'Fancy AI',
      description: `
  *Toggle the base prompt on/off.*

  This gives the AI instructions how to draw better graphics, math
  formulas and generally make the chat a little more fancy than just plain
  text. You can check/change the base prompt in the settings...`,
    }),
  tryUsingVisionModels: z.boolean().default(true).meta({
    icon: matVisibility,
    offIcon: matVisibilityOff,
    label: 'Vision',
    description:
      'Toggle Vision ON/OFF. If a model supports vision, we will try to use that for uploaded images',
  }),
  taskChatTemplates: z
    .object({
      basePrompt: z.string().meta({
        description:
          'The base prompt. This should be used e.g. to set the behaviour of the AI. used as a "system" prompt.',
      }),
      instruction: z.string().meta({
        description: 'This prompt is used to make the AI follow instructions',
      }),
      toolResult: z.string().meta({
        description:
          'This prompt is used to make the AI display tool results in a certain structured way.',
      }),
      task: z.string().meta({
        description: 'This prompt is used to explain to the AI what to do with a specific task.',
      }),
      evaluate: z.string().meta({
        description: 'This prompt is used to evaluate errors',
      }),
      schemaReminder: z.string().meta({
        description: 'This prompt is used to enforce a specific schema as a response...',
      }),
      tools: z.string().meta({
        description: 'This prompt is used to give the AI a list of tools.',
      }),
    })
    .meta({
      description:
        'These are the definitions of the prompts which are used in chats for different purposes.',
    }),
})
export type llmSettings = z.infer<typeof llmSettings>

/* ───────────────────────────────
   Tool-chain level configuration
   ─────────────────────────────── */
export const TyToolchainConfig = z.object({
  tools: z
    .record(z.string(), z.json())
    .default({})
    .describe(
      'Settings for a single tool. The tool ID is the ID of the tasknode where the tool is defined.',
    ),
}).describe(`All tool parameters can be turned into settings as well. This makes taskyons
configuration very adaptable to new tools.
Taskyon lets you configure each tool with optional defaut values.
Taskyon provides the option of letting profiles partially be overriden by each other.`)

export type TyToolchainConfig = z.infer<typeof TyToolchainConfig>

const hexColorRegex = /^#([A-Fa-f0-9]{6})$/
const HexColor = z
  .string()
  .superRefine((value, ctx) => {
    if (!hexColorRegex.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid hexadecimal color',
      })
    }
  })
  .meta({ format: 'color', description: 'Must be a 6‑digit hex color, e.g. #00FFAA' })

type HexColor = z.infer<typeof HexColor>

// rename to TyAppConfig
export const appConfiguration = z.object({
  darkTheme: z
    .union([z.literal('auto'), z.boolean()])
    .meta({ description: 'Explicitly set the taskyon dark mode' }),
  appConfigurationUrl: z.string().default('/taskyon_settings.json').meta({
    description: 'URL from which to load the initial app configuration',
  }),
  gdriveConfigurationFile: z.string().default('taskyon_settings.json').meta({
    description: 'gDrive fileid of the configuration',
  }),
  expertMode: z.boolean().default(false).meta({
    icon: mdiProfessionalHexagon,
    label: 'Expert Mode',
    description:
      'Turn on additional settings and configurations and debugging tools for advanced users.',
  }),
  showCosts: z.boolean().default(false).meta({
    description: 'Shows the costs of API calls.',
  }),
  gdriveDir: z.string().default('taskyon').meta({
    description: 'The default directory in gdrive, where taskyon saves its configuration.',
  }), // not sure, if we need this here?
  showLogo: z
    .boolean()
    .default(true)
    .meta({ description: 'Show a logo when now chat is selected' })
    .optional(),
  welcomeMsg: z
    .string()
    .default('')
    .meta({ description: 'A little message displayed when no chat is selected' })
    .optional(),
  chatSuggestions: z
    .array(
      z.union([
        z.object({ url: z.string(), label: z.string() }).meta({
          description:
            'Use url and label which point toa  markdown file which you want to use as a chat template!',
        }),
        z
          .object({ md: z.string(), label: z.string() })
          .meta({ description: 'Use a markdown string which will be used as a chat template.' }),
      ]),
    )
    .default([])
    .optional()
    .meta({
      description:
        'A list of getting started templates which appear as buttons when no chat is selected.',
    }),
  useEnterToSend: z.boolean().default(true).meta({
    icon: matKeyboardReturn,
    label: 'Use Enter to Send',
    description: 'Determines, if enter will automatically send a message or rather shift-enter',
  }),
  guiMode: z.enum(['auto', 'iframe', 'default', 'minChat']).default('auto').meta({
    description: 'Sets whether we want to have a minimalist chat or the full app',
  }),
  primaryColor: HexColor.meta({
    description: 'Primary color for custom taskyon theming. This should be a dark color',
  })
    .default('#2A3548')
    .optional(),
  secondaryColor: HexColor.meta({
    description:
      'Secondary color for custom taskyon theming. This color should be a bright color and contrast the primary color.',
  })
    .default('#F78F3B')
    .optional(),
})
export type appConfiguration = z.infer<typeof appConfiguration>

export const TyProfile = z.object({
  version: z.literal(19).meta({
    description:
      'whenever the schema of the settings change, this number will get changed as well...',
  }),
  appConfiguration,
  llmSettings,
  toolchainConfig: TyToolchainConfig,
  signatureOrKey: z.string().optional()
    .describe(`By specifying a signature it is possible to circumvent
usage of an API key. This way you can give your users access to taskyon with your own restrictions.`),
}).describe(`This is a taskyon profile which can be used to configure taskyon for different tasks.

This could for example mean to provide different service providers or different default
LLM models and other settings for tools.
`)
export type TyProfile = z.infer<typeof TyProfile>

export const tyPublicKeyDraft = z.object({
  name: z
    .string()
    .meta({
      description: 'Name of the key.',
    })
    .optional(),
  maxc: z
    .number()
    .meta({
      description: 'Maximum allowed credits in this key',
    })
    .optional(),
  cpi: z.number().meta({
    description: 'Credit refill per inteval',
  }),
  rti: z.number().meta({
    description: 'Refill time interval in minutes',
  }),
  model: z
    .string()
    .array()
    .meta({
      description: 'List of models which are allowed with this key.',
    })
    .optional(),
})

export type tyPublicKeyDraft = z.infer<typeof tyPublicKeyDraft>

export const tyPublicApiKeyObject = tyPublicKeyDraft.extend({
  iat: z.number().meta({
    description: 'Time at which the key was issued.',
  }),
  auid: z.string().meta({
    description: 'anonymous User ID for billing purposes.',
  }),
  v: z.number().meta({
    description: 'Key version',
  }),
  iss: z.string().meta({
    description: 'The Issuer of the API key.',
  }),
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

//export const convertZodToJsonSchemaCached = lruCache(100)(zodToJsonSchema)
export const convertZodToJsonSchemaCached = z.toJSONSchema

export const OAuthCredentials = z.object({
  type: z.literal('oauth-credentials'),
  access_token: z.string(),
  refresh_token: z.string(),
  service: z.string(), // or z.string().url() if you want URL validation
  token_type: z.string(),
  expires_in: z.number(),
  created_at: z.number(), // or z.date().transform(d => d.getTime()) if you parse a Date
})

export type OAuthCredentials = z.infer<typeof OAuthCredentials>
