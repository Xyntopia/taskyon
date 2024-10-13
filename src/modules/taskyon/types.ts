import type OpenAI from 'openai';
import { z } from 'zod';

//type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequireSome<T, K extends keyof T> = Omit<T, K> &
  Required<Pick<T, K>>;

export class TaskProcessingError extends Error {
  details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TaskFollowUpError';
    this.details = details;
  }
}

export type OnInterruptFunc = (
  callback: (reason: string | null) => void,
) => void;

// TODO: the goal should be to slowly replace this state by the "result of the task"
//       E.g. when a task had an error, this would be represented in the task result as an "error"
const TaskState = z.enum([
  'Open',
  'Queued',
  'In Progress',
  'Completed',
  'Cancelled',
  'Error',
])
  .describe(`The task state indicates on what is happening with the task: for example
it shows whether a task flow is seen as "completed" or whether its waiting
to be further processed... E.g. there could be a task with no results, which stil counts as "completed"`);
export type TaskState = z.infer<typeof TaskState>;

const OpenAIMessage = z.object({
  content: z.string().nullable(),
  function_call: z
    .object({
      name: z.string(),
      arguments: z.string(),
    })
    .optional(),
  tool_calls: z
    .array(
      z.object({
        name: z.string(),
        arguments: z.string(),
      }),
    )
    .optional(),
  name: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'function']),
});
export type OpenAIMessage = z.infer<typeof OpenAIMessage>;

export type ChatCompletionResponse = {
  id: string;
  object: string; // "chat.completion"
  created: number; // Unix timestamp in seconds
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason:
      | 'stop'
      | 'length'
      | 'tool_calls'
      | 'content_filter'
      | 'function_call'
      | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    origin?: string;
    inference_costs?: number;
  };
};

export interface OpenRouterGenerationInfo {
  id: string;
  total_cost: number;
  created_at: string; // ISO 8601 date string
  model: string;
  app_id: number;
  streamed: boolean;
  cancelled: boolean;
  provider_name: string;
  latency: number;
  moderation_latency: null | number; // can be null
  generation_time: number;
  finish_reason: string;
  tokens_prompt: number;
  tokens_completion: number;
  native_tokens_prompt: number;
  native_tokens_completion: number;
  num_media_prompt: null | number; // can be null
  num_media_completion: null | number; // can be null
  origin: string;
  usage: number;
}

// in order to prevent a circular reference in zod, we need to define our JSONSchemaForFunctionParameter
// separately
// https://zod.dev/?id=recursive-types
export interface JSONSchemaForFunctionParameter {
  $schema?: string;
  type: 'object';
  properties: {
    [key: string]: {
      type: string;
      description?: string;
      default?: unknown;
      items?: JSONSchemaForFunctionParameter | JSONSchemaForFunctionParameter[];
    };
  };
  required?: string[];
}

export const JSONSchemaForFunctionParameter: z.ZodType<JSONSchemaForFunctionParameter> =
  z.object({
    $schema: z.string().optional(),
    type: z.literal('object'),
    properties: z.record(
      z.object({
        type: z.string(),
        description: z.string().optional(),
        default: z.unknown().optional(),
        items: z
          .lazy(() =>
            z.union([
              JSONSchemaForFunctionParameter,
              z.array(JSONSchemaForFunctionParameter),
            ]),
          )
          .optional(),
      }),
    ),
    required: z.array(z.string()).optional(),
  });

export const FunctionName = z
  .string()
  .refine(
    (val) => /^[a-zA-Z0-9_-]+$/.test(val),
    (val) => ({
      message: `The function/tool name ${val} contains illegal characters. It has to fulfill '^[a-zA-Z0-9_-]+$'`,
    }),
  )
  .describe('name of function');
export type FunctionName = z.infer<typeof FunctionName>;

export const ToolBase = z.object({
  description: z.string(),
  longDescription: z.string().optional(),
  name: FunctionName,
  parameters: JSONSchemaForFunctionParameter,
  code: z
    .string()
    .optional()
    .describe(
      "If a function description doesn't include any code taskyon will call a postMessage to the parent window with the function name.",
    ),
});
export type ToolBase = z.infer<typeof ToolBase>; // this reflects json schema:  https://json-schema.org/specification-links

const ToolResult = z.object({
  result: z.union([z.string(), z.record(z.unknown())]).optional(),
  error: z.unknown().optional(), // 'unknown' type in Zod is handled with 'z.unknown()'
  stdout: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;

// TODO: get rid of OpenAI dependency...
const chatResponse: z.ZodType<OpenAI.ChatCompletion> = z.any();

export const TaskResult = z.object({
  chatResponse: chatResponse.optional(),
  toolResult: ToolResult.optional(), // Replace 'z.any()' with the specific type if available
});
export type TaskResult = z.infer<typeof TaskResult>;

export const ParamType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);
export type ParamType = z.infer<typeof ParamType>;
const FunctionArguments = z
  .record(ParamType)
  .describe('arguments of the function');
export type FunctionArguments = z.infer<typeof FunctionArguments>;

/* here we are essentiall declaring the taskyon API */
export const FunctionCall = z.object({
  name: FunctionName,
  arguments: FunctionArguments,
});
export type FunctionCall = z.infer<typeof FunctionCall>;

export const RemoteFunctionBase = z.object({
  functionName: z.string().describe('the name of the function'),
});

export const RemoteFunctionCall = RemoteFunctionBase.extend({
  type: z
    .literal('functionCall')
    .describe('Field to indicate what kind of a message we have here.'),
  arguments: FunctionArguments.optional().describe(
    'the arguments for the function as a json object',
  ),
}).describe(
  'This type is used for sending messages with function calls between windows. E.g. from iframe to parent',
);
export type RemoteFunctionCall = z.infer<typeof RemoteFunctionCall>;

export const RemoteFunctionResponse = RemoteFunctionBase.extend({
  type: z
    .literal('functionResponse')
    .describe('Field to indicate what kind of a message we have here.'),
  response: z
    .unknown()
    .optional()
    .describe(
      'response of a FunctionCall, e.g. through postMessage with iframes.',
    ),
}).describe(
  'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe',
);
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>;

const answer = z.string().nullish();
const yesno = z.enum(['yes', 'no']).or(z.boolean()).nullish();
type yesno = z.infer<typeof yesno>;

// Convert yesno value to boolean
export const yesnoToBoolean = (value: yesno | unknown): boolean => {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return !!value; // Handles boolean, null, undefined
};

// this one here is important. It should be as simple as possible
// this type is used to parse & describe tool commands
// an LLM should be able to generaate this content...
export const UseToolBase = z.object({
  'use tool': yesno,
  'which tool': answer,
  command: FunctionCall.nullable()
    // right now, we don't know a good way to simultanously
    // parse robustly and describe precisely
    // we simply "normalize" all "no, {}, null" etc.. into undefined
    /*z.union([
      FunctionCall, // Accepts valid FunctionCall
      z.null(), // Accepts null
      z.object({}), // Accepts an empty object {}
      yesno, // Accepts yes/no object
    ])*/
    .optional()
    .describe(
      'If we should use a tool in the following step, provide the tool command. Otherwise do not!!',
    ),
});

const SystemResponseEvaluation = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'do you think we can solve the error?': yesno,
    'Would it help to use one of the mentioned tools to solve the issue?':
      yesno,
    'Should we try to correct the error': yesno,
    'try again': yesno,
  })
  .describe(
    'This is used as a short prompt for tasks in order to determine whether we should use a more detailed task prompt',
  );

const ToolResultBase = z
  .object({
    'describe your thoughts': answer,
    'was there an error?': yesno,
    'was the tool call successfull?': answer.or(yesno),
    'should we use a different tool?': answer.or(yesno),
    'should we use different parameters': yesno,
    'try again': yesno,
  })
  .describe(
    'Structured answer schema for processing the result of a function call.',
  );

const ToolSelection = z
  .object({
    'describe your thoughts': answer,
  })
  .describe('Structured answer schema for a task including the use of tools');

export const StructuredResponseTypes = {
  ToolResultBase,
  ToolSelection,
  SystemResponseEvaluation,
};
export const StructuredResponse = ToolResultBase.partial()
  .merge(ToolSelection.partial())
  .merge(SystemResponseEvaluation.partial())
  .merge(UseToolBase.partial());
export type StructuredResponse = z.infer<typeof StructuredResponse>;

const MessageContent = z.object({ message: z.string() });
const StructuredContent = z.object({ structuredResponse: z.string() });
const ToolCallContent = z.object({ functionCall: FunctionCall });
const UploadedFilesContent = z.object({ uploadedFiles: z.array(z.string()) });
// TODO: restructure ToolResultContent to be a "normal message"
const ToolResultContent = z.object({ toolResult: ToolResult });
const TaskContent = z.union([
  StructuredContent,
  MessageContent,
  ToolCallContent,
  UploadedFilesContent,
  ToolResultContent,
]);

// TODO: add an "extended" task and put all information in there which we don't really "need"
//       to save in the database. E.g. how many follow-up tasks are allowed, how many
//       errors are allowed for function tasks  etc...  so mostly runtime-logic
export const TaskNode = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  name: z.string().optional(),
  content: TaskContent.default({ message: '' }).describe(
    `This is the actual content of the task. This is the actual content which is process at each step.
For example this is, what an LLM would actually get to see. There are only a few different ways
of how content can be structured. `,
  ),
  state: TaskState,
  label: z.array(z.string()).optional(),
  context: z.record(z.string(), z.string()).optional(),
  configuration: z
    .object({
      model: z.string(),
      chatApi: z.string(),
    })
    .optional()
    .describe('Holds the configuration for the LLM'),
  parentID: z.string().optional(),
  // TODO: get rid of this parameter in order to make our tasktree
  childrenIDs: z.array(z.string()),
  // provide debugging information about the task execution
  // all debugging information should be purely optional...
  debugging: z.object({
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
    aiResponse: z.any().optional(), // Replace with the correct Zod schema if available
    error: z.unknown().optional(),
    // the taskprompt is the full chat which leads to the result. This is important that we have this
    // for to debugging reasons...
    taskPrompt: z.union([z.array(OpenAIMessage), z.any()]).optional(), // Replace 'z.any()' with the correct Zod type
  }),
  result: TaskResult.optional(),
  id: z.string(), // can we make the id an SHA-1 value like in git? in that case we should simply remove this value...
  allowedTools: z.array(z.string()).optional(),
  authorId: z.string().optional(),
  created_at: z.number().optional(),
});
export type TaskNode = z.infer<typeof TaskNode>;

export const TaskListType = z.array(TaskNode);
export type TaskListType = z.infer<typeof TaskListType>;

export type TaskGetter = (input: string) => Promise<TaskNode | undefined>;

export const partialTaskDraft = TaskNode.pick({
  role: true,
  content: true,
  parentID: true,
  name: true,
  configuration: true,
  state: true,
  allowedTools: true,
  debugging: true,
  label: true,
})
  .partial()
  .required({ role: true, content: true })
  .describe(
    'This is just a subset of the task properties which can be used to define new tasks in various places.',
  );
export type partialTaskDraft = z.infer<typeof partialTaskDraft>;

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
};

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
  id: string;
  object: string;
  created: number;
  allow_create_engine: boolean;
  allow_sampling: boolean;
  allow_logprobs: boolean;
  allow_search_indices: boolean;
  allow_view: boolean;
  allow_fine_tuning: boolean;
  organization: string;
  group: null | string;
  is_blocking: boolean;
}

export interface Model {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  object?: string;
  created?: number;
  owned_by?: string;
  permission?: Permission[];
  root?: string;
  parent?: null | string;
  pricing?: {
    prompt: string;
    completion: string;
    discount?: number;
    image?: string;
    request?: string;
  };
  top_provider?: {
    max_completion_tokens: number | null;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
  };
  per_request_limits?: {
    prompt_tokens: string;
    completion_tokens: string;
  } | null;
}

const apiConfig = z
  .object({
    name: z.string().describe('The name of the API.'),
    baseURL: z.string().describe('Base URL of the api.'),
    defaultModel: z
      .string()
      .describe('the default model which should be used for this API.'),
    selectedModel: z
      .string()
      .optional()
      .describe('which model is currently selected.'),
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
      .describe(
        'If the API needs some special headers for communication (e.g. an API key.)',
      ),
    routes: z.object({
      chatCompletion: z.string().describe('Endpoint for chatcompletion.'),
      models: z.string().describe('Endpoint for list of models.'),
    }),
  })
  .describe('Definition of an OpenAI Compatible API.');
export type apiConfig = z.infer<typeof apiConfig>;

export const llmSettings = z.object({
  // this refers to the task chain that we have currently selected. We select one task and then
  // put the chain together by following the parentIds.
  selectedTaskId: z
    .string()
    .optional()
    .describe(
      'The currently selected conversation defined by the ID of its last node.',
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
  llmApis: z
    .record(apiConfig)
    .default({})
    .describe('A list of OpenAI compatible API definitions.'),
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
    .describe(
      'The task which is currently drafted (This could for example be a simple message).',
    ),
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
      instruction: z
        .string()
        .default('This prompt is used to make the AI follow instructions'),
      toolResult: z
        .string()
        .default(
          'This prompt is used to make the AI display tool results in a certain structured way.',
        ),
      task: z
        .string()
        .default(
          'This prompt is used to explain to the AI what to do with a specific task.',
        ),
      evaluate: z.string().default('This prompt is used to evaluate errors'),
    })
    .describe(
      'These are the definitions of the prompts which are used in chats for different purposes.',
    ),
});
export type llmSettings = z.infer<typeof llmSettings>;

const hexColorRegex = /^#([A-Fa-f0-9]{6})$/;
const HexColor = z.string().superRefine((value, ctx) => {
  if (!hexColorRegex.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid hexadecimal color',
    });
  }
});
type HexColor = z.infer<typeof HexColor>;

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
  showCosts: z
    .boolean()
    .default(false)
    .describe('Shows the costs of API calls.'),
  gdriveDir: z
    .string()
    .default('taskyon')
    .describe(
      'The default directory in gdrive, where taskyon saves its configuration.',
    ), // not sure, if we need this here?
  useEnterToSend: z
    .boolean()
    .default(true)
    .describe(
      'Determines, if enter will automatically send a message or rather shift-enter',
    ),
  guiMode: z
    .enum(['auto', 'iframe', 'default'])
    .default('auto')
    .describe('Sets whether we want to have a minimalist chat or the full app'),
  primaryColor: HexColor.describe('The primary color of taskyons color scheme.')
    .optional()
    .describe(
      'Primary color for custom taskyon theming. This should be a dark color',
    ),
  secondaryColor: HexColor.describe(
    'The secondary color of taskyons color scheme.',
  )
    .optional()
    .describe(
      'Secondary color for custom taskyon theming. This color should be a bright color and contrast the primary color.',
    ),
});
export type appConfiguration = z.infer<typeof appConfiguration>;

export const storedSettings = z.object({
  version: z
    .literal(9)
    .describe(
      'whenever the schema of the settings change, this number will get changed as well...',
    ),
  appConfiguration,
  llmSettings,
  signatureOrKey: z.string().optional()
    .describe(`By specifying a signature it is possible to circumvent
usage of an API key. This way you can give your users access to taskyon with your own restrictions.`),
});
export type storedSettings = z.infer<typeof storedSettings>;

export const partialTyConfiguration = storedSettings
  .deepPartial()
  .describe(
    'This can be used to update the configuration through iframe, json or URL',
  );
export type partialTyConfiguration = z.infer<typeof partialTyConfiguration>;

export const TaskMessage = z
  .object({
    type: z
      .literal('task')
      .describe('Field to indicate what kind of a message we have here.'),
    task: partialTaskDraft,
    execute: z
      .boolean()
      .default(false)
      .describe('should the task be queued for execution?'),
    duplicateTaskName: z
      .boolean()
      .default(true)
      .describe(
        `Only add the task if a task with this name doesn't exist. We do this, because otherwise tasks get 
        added on every page-load if we configure our app through an iframe parent.`,
      ),
  })
  .describe(
    'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe',
  );
export type TaskMessage = z.infer<typeof TaskMessage>;

export const FunctionDescriptionMessage = ToolBase.extend({
  type: z
    .literal('functionDescription')
    .describe('Field to indicate that this is a function description message.'),
  id: z.string()
    .describe(`A unique id for the function task. Tasks with the same id "overwrite" each other. The last one
is the relevant one. Functions will get saved as a task object with the id as their name.

this is important!, Taskyon can be configured to prevent tasks from getting created if they already exist with the same name!
this helps in making sure, that tasks & tools which we upload to taskyon on pageload don't get duplicated
on every pageload.
If that option is turned on, we can use this as a version string for our tasks... And every time we want
to update our webpage with a new AI tool, we simply change the version string...
`),
  duplicateTaskName: z
    .boolean()
    .describe(
      'we use this here in order to prevent duplicate creation of our function declaration task',
    ),
});
export type FunctionDescriptionMessage = z.infer<
  typeof FunctionDescriptionMessage
>;

export const ClientFunctionDescription = FunctionDescriptionMessage.extend({
  function: z
    .function()
    .describe(
      'The client-side callback function which taskyon is allowed to call.',
    ),
}).omit({ type: true, duplicateTaskName: true });
export type ClientFunctionDescription = z.infer<
  typeof ClientFunctionDescription
>;

export const tyConfigurationMessage = z.object({
  type: z
    .literal('configurationMessage')
    .describe('Field to indicate that this is a function description message.'),
  conf: partialTyConfiguration,
});
export type tyConfigurationMessage = z.infer<typeof tyConfigurationMessage>;

export const TaskyonMessages = z.discriminatedUnion('type', [
  RemoteFunctionCall,
  RemoteFunctionResponse,
  TaskMessage,
  FunctionDescriptionMessage,
  z
    .object({ type: z.literal('taskyonReady') })
    .describe('simple message which signals, that our API is ready!'),
  tyConfigurationMessage,
]);
export type TaskyonMessages = z.infer<typeof TaskyonMessages>;

export const tyPublicKeyDraft = z.object({
  name: z.string().describe('Name of the key.').optional(),
  maxc: z.number().describe('Maximum allowed credits in this key').optional(),
  cpi: z.number().describe('Credit refill per inteval'),
  rti: z.number().describe('Refill time interval in minutes'),
  model: z
    .string()
    .array()
    .describe('List of models which are allowed with this key.')
    .optional(),
});

export type tyPublicKeyDraft = z.infer<typeof tyPublicKeyDraft>;

export const tyPublicApiKeyObject = tyPublicKeyDraft.extend({
  iat: z.number().describe('Time at which the key was issued.'),
  auid: z.string().describe('anonymous User ID for billing purposes.'),
  v: z.number().describe('Key version'),
  iss: z.string().describe('The Issuer of the API key.'),
});
