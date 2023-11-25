import { z } from 'zod';
import { FunctionCall } from './tools';
import type OpenAI from 'openai';
import { dump } from 'js-yaml';

export type TaskState =
  | 'Open'
  | 'Queued'
  | 'In Progress'
  | 'Completed'
  | 'Error'
  | 'Cancelled';

export type OpenAIMessage = {
  // The content of the message, can be null for some messages.
  content: string | null;
  // Function call details if applicable.
  function_call?: {
    // The name of the function to call.
    name: string;
    // Arguments to call the function with in JSON format.
    arguments: string;
  };
  // The name of the message author (optional) it has to be the name of the function, if
  // the role is "function".
  name?: string;
  // The role of the message author (system, user, assistant, or function).
  role: 'system' | 'user' | 'assistant' | 'function';
};

export type ChatCompletionResponse = {
  id: string;
  object: string; // "chat.completion"
  created: number; // Unix timestamp in seconds
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
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

export interface ToolResult {
  result?: string | Record<string, unknown>;
  error?: unknown;
  stdout?: string;
}

export interface TaskResult {
  type:
    | 'ChatAnswer'
    | 'AssistantAnswer'
    | 'ToolCall'
    | 'ToolResult'
    | 'ToolError'
    | 'ToolChatResult';
  assistantResponse?: OpenAI.Beta.Threads.Messages.ThreadMessage[];
  chatResponse?: ChatCompletionResponse;
  toolResult?: ToolResult; // Description or value of the result
}

export type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  state: TaskState;
  context?: {
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
    // the costs used to solve this task...
    taskCosts?: number;
    aiResponse?: ChatCompletionResponse;
    error?: unknown;
    taskPrompt?: OpenAIMessage[];
    followUpError?: unknown;
  };
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
  created_at?: number; //unix timestamp
};

export type partialTaskDraft = {
  role: LLMTask['role'];
  content?: LLMTask['content'];
  context?: LLMTask['context'];
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
  reasoning: z.string(),
  satisfactory: z.boolean().describe('was the result satisfactory?'),
  answer: answer
    .optional()
    .describe('Only provide answer if result was satisfactory.'),
  useTool: z
    .optional(z.boolean())
    .describe('Only use a tool, if the result was not satisfactory!!'),
  useToolReason: z
    .optional(z.string())
    .describe('Reason, why we should use a tool/function again?'),
  toolCommand: toolCommandChat
    .describe(
      'Only fill toolCommand if useTool = true otherwise provide answer!'
    )
    .optional(),
});
export type toolResultChat = z.infer<typeof toolResultChat>;

export const yamlToolChatType = z.object({
  reasoning: z.string(),
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
