import type OpenAI from 'openai';
import { dump } from 'js-yaml';
import { z } from 'zod';

//type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequireSome<T, K extends keyof T> = Omit<T, K> &
  Required<Pick<T, K>>;

// TODO: the goal should be to slowly replace this state by the "result of the task"
//       E.g. when a task had an error, this would be represented in the task result as an "error"
const TaskState = z.enum([
  'Open',
  'Queued',
  'In Progress',
  'Completed',
  'Cancelled',
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
      })
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
  data: {
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
  };
}

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
            ])
          )
          .optional(),
      })
    ),
    required: z.array(z.string()).optional(),
  });

export const ToolBase = z.object({
  description: z.string(),
  longDescription: z.string().optional(),
  name: z.string().describe(''),
  parameters: JSONSchemaForFunctionParameter,
  code: z
    .string()
    .optional()
    .describe(
      "If a function description doesn't include any code taskyon will call a postMessage to the parent window with the function name."
    ),
});
export type ToolBase = z.infer<typeof ToolBase>; // this reflects json schema:  https://json-schema.org/specification-links

const ToolResult = z.object({
  result: z.union([z.string(), z.record(z.unknown())]).optional(),
  error: z.unknown().optional(), // 'unknown' type in Zod is handled with 'z.unknown()'
  stdout: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;

const assistantThreadMessage: z.ZodType<OpenAI.Beta.Threads.Messages.ThreadMessage> =
  z.any();

const chatResponse: z.ZodType<OpenAI.ChatCompletion> = z.any();

export const TaskResult = z.object({
  type: z.enum([
    'ChatAnswer',
    'AssistantAnswer',
    'ToolResult', // the result is the result of a tool function execution
    'ToolError',
    'ToolCall',
    // TODO: It might be a good idea to get rid of "ToolCall" and integrate it with
    // StructuredChatResponse
    // sometimes the result is a direct tool call (e.g. from an OpenAI API response).
    // And this gets indicated here
    // when we want to get a structured response about how to continue from our LLM e.g.
    // to start a tool or interprete a function result or create new tasks...
    'StructuredChatResponse',
  ]),
  assistantResponse: z.array(assistantThreadMessage).optional(),
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
  .describe('arguments of a function specified by json schema');
export type FunctionArguments = z.infer<typeof FunctionArguments>;

/* here we are essentiall declaring the taskyon API */
export const FunctionCall = z.object({
  name: z.string().describe('name of function'),
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
    'the arguments for the function as a json object'
  ),
}).describe(
  'This type is used for sending messages with function calls between windows. E.g. from iframe to parent'
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
      'response of a FunctionCall, e.g. through postMessage with iframes.'
    ),
}).describe(
  'This type is used for sending messages with the result of a remote function call between windows. E.g. from parent to taskyon iframe'
);
export type RemoteFunctionResponse = z.infer<typeof RemoteFunctionResponse>;

const MessageContent = z.object({ message: z.string() });
const FunctionCallContent = z.object({ functionCall: FunctionCall });
const UploadedFilesContent = z.object({ uploadedFiles: z.array(z.string()) });
const ToolResultContent = z.object({ functionResult: ToolResult });
const TaskContent = z.union([
  MessageContent,
  FunctionCallContent,
  UploadedFilesContent,
  ToolResultContent,
]);
export const ContentDraft = MessageContent.merge(FunctionCallContent)
  .merge(UploadedFilesContent)
  .merge(ToolResultContent)
  .partial();
export type ContentDraft = z.infer<typeof ContentDraft>;

// TODO: add an "extended" task and put all information in there which we don't really "need"
//       to save in the database. E.g. how many follow-up tasks are allowed, how many
//       errors are allowed for function tasks  etc...  so mostly runtime-logic
export const LLMTask = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  name: z.string().optional(),
  // this is the actual content of the task
  content: TaskContent,
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
    followUpError: z.unknown().optional(),
  }),
  result: TaskResult.optional(),
  id: z.string(), // can we make the id an SHA-1 value like in git? in that case we should simply remove this value...
  allowedTools: z.array(z.string()).optional(),
  authorId: z.string().optional(),
  created_at: z.number().optional(),
});
export type LLMTask = z.infer<typeof LLMTask>;

export type TaskGetter = (input: string) => Promise<LLMTask | undefined>;

export const partialTaskDraft = LLMTask.pick({
  role: true,
  content: true,
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
    'This is just a subset of the task properties which can be used to define new tasks in various places.'
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
  .merge(LLMTask['configuration']).default({
    role: 'system',
    configuration: {
      message: "test"
    },
    label: ['file']
  })*/
};

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
        added on every page-load if we configure our app through an iframe parent.`
      ),
  })
  .describe(
    'With this message type we can send tasks to taskyon from outside, e.g. a parent to a taskyon iframe'
  );
export type TaskMessage = z.infer<typeof TaskMessage>;

export const FunctionDescriptionMessage = z
  .object({
    type: z
      .literal('functionDescription')
      .describe(
        'Field to indicate that this is a function description message.'
      ),
    functionDescription: ToolBase.or(z.string()),
    activate: z
      .boolean()
      .describe('activate the function immediatly after declaration'),
  })
  .describe(
    `With this message type we can send new functions to taskyon from outside, e.g. a parent to a taskyon iframe
  taskyon will recognize them as`
  );

export const TaskyonMessages = z.discriminatedUnion('type', [
  RemoteFunctionCall,
  RemoteFunctionResponse,
  TaskMessage,
  z
    .object({ type: z.enum(['taskyonReady']) })
    .describe('signals, that our API is ready!'),
]);
export type TaskyonMessages = z.infer<typeof TaskyonMessages>;

interface YamlObjectRepresentation {
  [key: string]: YamlRepresentation;
}

export type YamlRepresentation =
  | string
  | YamlObjectRepresentation
  | YamlArrayRepresentation;
interface YamlArrayRepresentation {
  type: 'array';
  items: YamlRepresentation;
}

/* convert a zod schema into a nested object where the description
appear in keys starting with '#'
*/
export function zodToYAMLObject(
  schema: z.ZodTypeAny,
  optionalSymbol = '',
  unwrapUnions = false
): YamlRepresentation {
  // Base case for primitive types
  if (schema instanceof z.ZodString) {
    return 'string';
  } else if (schema instanceof z.ZodNumber) {
    return 'number';
  } else if (schema instanceof z.ZodBoolean) {
    return 'boolean';
  } else if (schema instanceof z.ZodNull) {
    return 'null';
  } else if (schema instanceof z.ZodEnum) {
    return Object.keys(schema.Values).join('|');
  }

  // Modified ZodObject case to handle optionals
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape as Record<
      string,
      z.ZodTypeAny
    >;
    const yamlObject: YamlObjectRepresentation = {};
    for (const key in shape) {
      const fieldSchema = shape[key];
      const optionalSuffix =
        fieldSchema instanceof z.ZodOptional ? optionalSymbol : '';
      if (fieldSchema?.description) {
        yamlObject[`# ${key} description`] =
          `${fieldSchema.description} ${optionalSuffix}`.trim();
      }
      yamlObject[key] = zodToYAMLObject(fieldSchema);
    }
    return yamlObject;
  }

  // Handle arrays
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToYAMLObject(schema.element),
    };
  }

  // records
  if (schema instanceof z.ZodRecord) {
    const values = zodToYAMLObject(schema.element);
    return {
      key1: values,
      key2: values,
      '...': '...',
    };
  }

  // TODO: what do we do with arrays & objects in this example?
  // Handle union types
  if (schema instanceof z.ZodUnion) {
    const options = (schema.options as z.ZodTypeAny[])
      .map((option) => {
        const val = zodToYAMLObject(option);
        if (typeof val === 'object') {
          return undefined;
        }
        return val;
      })
      .filter((r) => r);
    return options.join('|');
  }

  // Modified ZodOptional case
  if (schema instanceof z.ZodOptional) {
    return zodToYAMLObject(schema.unwrap());
  }

  // Modified ZodOptional case
  if (schema instanceof z.ZodNullable) {
    return zodToYAMLObject(schema.unwrap());
  }

  // Add more cases as needed for other Zod types (unions, etc.)
  // Fallback for unsupported types
  return 'unsupported';
}

export function zodToYamlString(schema: z.ZodTypeAny): string {
  const objrepr = zodToYAMLObject(schema);
  const yamlSchema = convertToYamlWComments(dump(objrepr));
  return yamlSchema;
}

const answer = z.string().nullish();
const yesno = z.enum(['yes', 'no']).or(z.boolean()).nullish();

const FunctionResultBase = z
  .object({
    'describe your thoughts': answer,
    'was the tool call successfull?': answer,
    'should we retry?': yesno,
    'should we use another tool?': answer,
    'use tool': yesno,
    toolCommand: FunctionCall.optional().describe(
      'If you want to use a tool, provide the function call parameters'
    ),
    answer: answer.describe(
      'Otherwise provide a final answer summarizing the result.'
    ),
  })
  .describe(
    'Structured answer schema for processing the result of a function call.'
  );

const ToolSelection = z
  .object({
    'describe your thoughts': answer,
    'use tool': yesno,
    'which tool': answer,
    toolCommand: FunctionCall.optional().describe(
      'If you want to use a tool, provide the function call parameters'
    ),
    answer: answer.describe(
      'Otherwise provide a final answer with your thoughts'
    ),
  })
  .describe('Structured answer schema for a task including the use of tools');

export const StructuredResponseTypes = {
  FunctionResultBase,
  ToolSelection,
};
export const StructuredResponse = z.union([FunctionResultBase, ToolSelection]);
export type StructuredResponse = z.infer<typeof StructuredResponse>;

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

/**
 * Converts a string representation of an object to YAML format with comments.
 * 
 * This function takes a string representation of an object as input, extracts comments
 * from it, which are represented by a key, starting with an '#'
 * and returns a new string in YAML format with the comments preserved, but the keys removed.
 * 
 * this:
 * 
  # comment: >-
        # This is a comment
        # spanning multiple lines
  bar: baz
  qux: quux

  becomes:

  # This is a comment
  # spanning multiple lines
  bar: baz
  qux: quux

and this:



 * 
 * @param {string} objrepr - The string representation of the object to be converted.
 * @returns {string} The converted YAML string with comments.
 */
export function convertToYamlWComments(objrepr: string) {
  // Regular expression to match the entire comment section, including the key and optional '>-'
  // The regex pattern is broken down as follows:
  // ( *) - captures the indentation (group 1)
  // (# .*:) - captures the key (group 2)
  // \s*(>-)? - captures the optional '>-'
  // ([\s\S]*?) - captures the comment block (group 4)
  // (?=\n\s*\S+:|$) - ensures the match is followed by a newline and indentation, or the end of the string
  const regex = /( *)(('# .*:)\s*(>-)?)([\s\S]*?)(?=\n\s*\S+:|$)/g;

  return objrepr.replace(
    regex,
    (
      match, // the entire match
      indent: string, // the indentation (group 1)
      keyX, // the key (group 2, not used)
      key, // the key (group 3, not used)
      keyEnd: string, // the optional '>-'
      commentBlock: string // the comment block (group 4)
    ) => {
      const isMultiline = !!keyEnd; // check if the comment block is multiline (i.e., has a '>-')
      // Modify each line of the comment block
      let modifiedCommentBlock = [];
      if (isMultiline) {
        // Split the comment block into individual lines
        const commentLines = commentBlock.split('\n').filter((l) => l.trim());
        // Trim the first line and apply the indentation to all other lines
        modifiedCommentBlock = commentLines.map((line) => {
          return indent + '# ' + line.trim(); // add the indentation and '#' to each line
        });
      } else {
        // If the comment block is not multiline, simply add the indentation and '#' to it
        modifiedCommentBlock = [indent + '# ' + commentBlock];
      }
      return modifiedCommentBlock.join('\n');
    }
  );
}
