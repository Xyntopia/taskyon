import type OpenAI from 'openai';
import { dump } from 'js-yaml';
import { z } from 'zod';

const TaskState = z.enum([
  'Open',
  'Queued',
  'In Progress',
  'Completed',
  'Error',
  'Cancelled',
]);
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
    model: string;
    streamed: boolean;
    generation_time: number;
    created_at: string;
    tokens_prompt: number;
    tokens_completion: number;
    native_tokens_prompt: null | number;
    native_tokens_completion: null | number;
    num_media_generations: null | number;
    origin: string;
    usage: number;
  };
}

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
    'ToolCall',
    'ToolResult',
    'ToolError',
    'ToolChatResult',
  ]),
  assistantResponse: z.array(assistantThreadMessage).optional(),
  chatResponse: chatResponse.optional(),
  toolResult: ToolResult.optional(), // Replace 'z.any()' with the specific type if available
});
export type TaskResult = z.infer<typeof TaskResult>;

export const toolStateType = z.enum([
  'available',
  'starting',
  'unavailable',
  'error',
]);
export type toolStateType = z.infer<typeof toolStateType>;
export const ParamType = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);
export type ParamType = z.infer<typeof ParamType>;
const FunctionArguments = z.record(ParamType);
export type FunctionArguments = z.infer<typeof FunctionArguments>;

export const FunctionCall = z.object({
  name: z.string(),
  arguments: FunctionArguments,
});
export type FunctionCall = z.infer<typeof FunctionCall>;

/*export type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  state: TaskState;
  configuration?: {
    message?: OpenAIMessage;
    function?: FunctionCall;
    model?: string;
    uploadedFiles?: string[];
  };
  // is undefined in the case it is an "initial" task
  parentID?: string | undefined;
  childrenIDs: string[];
  debugging: {
    threadMessage?: OpenAI.Beta.Threads.Messages.ThreadMessage;
    promptTokens?: number;
    resultTokens?: number;
    taskTokens?: number;
    estimatedTokens?: {
      resultTokens?: number;
      taskCosts?: number;
      functionTokens?: number;
      promptTokens?: number;
      singlePromptTokens?: number;
    };
    toolStreamArgsContent?: Record<string, string>;
    streamContent?: string;
    // the costs used to solve this task...
    taskCosts?: number;
    aiResponse?: ChatCompletionResponse;
    error?: unknown;
    taskPrompt?: OpenAIMessage[] | OpenAI.ChatCompletionMessageParam[];
    followUpError?: unknown;
  };
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
  created_at?: number; //unix timestamp
};*/

export const LLMTask = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  content: z.string().nullable(),
  state: TaskState,
  configuration: z
    .object({
      message: OpenAIMessage.optional(),
      function: FunctionCall.optional(),
      model: z.string().optional(),
      chatApi: z.string().optional(),
      uploadedFiles: z.array(z.string()).optional(),
    })
    .optional(),
  parentID: z.string().optional(),
  childrenIDs: z.array(z.string()),
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
    taskPrompt: z.union([z.array(OpenAIMessage), z.any()]).optional(), // Replace 'z.any()' with the correct Zod type
    followUpError: z.unknown().optional(),
  }),
  result: TaskResult.optional(),
  id: z.string(),
  allowedTools: z.array(z.string()).optional(),
  authorId: z.string().optional(),
  created_at: z.number().optional(),
});
export type LLMTask = z.infer<typeof LLMTask>;

export type partialTaskDraft = {
  role: LLMTask['role'];
  content?: LLMTask['content'];
  configuration?: LLMTask['configuration'];
  state?: LLMTask['state'];
  allowedTools?: LLMTask['allowedTools'];
  debugging?: LLMTask['debugging'];
};
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
export function zodToYAMLObject(schema: z.ZodTypeAny): YamlRepresentation {
  // Base case for primitive types
  if (schema instanceof z.ZodString) {
    return 'string';
  } else if (schema instanceof z.ZodNumber) {
    return 'number';
  } else if (schema instanceof z.ZodBoolean) {
    return 'boolean';
  } else if (schema instanceof z.ZodNull) {
    return 'null';
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
      const optionalSuffix = fieldSchema instanceof z.ZodOptional ? '?' : '';
      if (fieldSchema.description) {
        yamlObject[`# ${key} description`] = fieldSchema.description;
      }
      yamlObject[key + optionalSuffix] = zodToYAMLObject(fieldSchema);
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

  // Handle union types
  if (schema instanceof z.ZodUnion) {
    const options = (schema.options as z.ZodTypeAny[]).map((option) =>
      zodToYAMLObject(option)
    );
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

export const toolCommandChat = z.object({
  name: z.string(),
  args: z.record(z.union([z.string(), z.number(), z.boolean()])),
});

export type toolCommandChat = z.infer<typeof toolCommandChat>;

const answer = z.string().nullable();

export const toolResultChat = z.object({
  thought: z.string().optional(),
  satisfactory: z.boolean().describe('was the result satisfactory?'),
  answer: answer
    .optional()
    .describe('Only provide answer if result was satisfactory.'),
  useToolReason: z
    .optional(z.string())
    .describe('Reason, why we should (not) use a tool/function again?'),
  useTool: z
    .optional(z.boolean())
    .describe('Only use a tool, if the result was not satisfactory!!'),
  toolCommand: toolCommandChat
    .describe(
      'Only fill toolCommand if useTool = true otherwise provide answer!'
    )
    .optional(),
});
export type toolResultChat = z.infer<typeof toolResultChat>;

export const yamlToolChatType = z.object({
  thought: z
    .string()
    .optional()
    .describe('your thoughts about what to do about the task'),
  useTool: z.optional(z.boolean()),
  toolCommand: toolCommandChat
    .describe(
      'Only fill toolCommand if useTool = true otherwise provide answer!'
    )
    .optional(),
  answer: answer
    .optional()
    .describe('Only provide answer if we are not using a tool.'),
});

export type yamlToolChatType = z.infer<typeof yamlToolChatType>;

export const yamlTaskSchema = yamlToolChatType.extend({
  thoughts: z.string(),
  reasoning: z.string(),
  plan: z.string().array(),
  criticism: z.string(),
});

export type yamlTaskSchema = z.infer<typeof yamlTaskSchema>;

export function convertToYamlWComments(objrepr: string) {
  // Regular expression to match the entire comment section, including the key and optional '>-'
  const regex = /( *)(('# .*:)\s*(>-)?)([\s\S]*?)(?=\n\s*\S+:|$)/g;

  return objrepr.replace(
    regex,
    (
      match,
      indent: string,
      keyX,
      key,
      keyEnd: string,
      commentBlock: string
    ) => {
      const isMultiline = !!keyEnd;
      // Modify each line of the comment block
      let modifiedCommentBlock = [];
      if (isMultiline) {
        const commentLines = commentBlock.split('\n').filter((l) => l.trim());
        // Trim the first line and apply the indentation to all other lines
        modifiedCommentBlock = commentLines.map((line) => {
          return indent + '# ' + line.trim();
        });
      } else {
        modifiedCommentBlock = [indent + '# ' + commentBlock];
      }
      return modifiedCommentBlock.join('\n');
    }
  );
}
