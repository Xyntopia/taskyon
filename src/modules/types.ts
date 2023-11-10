import { FunctionCall } from './tools';

export type TaskState =
  | 'Open'
  | 'Queued'
  | 'In Progress'
  | 'Completed'
  | 'Error';

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

export interface TaskResult {
  type: 'ChatAnswer' | 'FunctionCall' | 'NewTask' | 'FunctionResult'; // Type of result
  content?: string; // Description or value of the result
  functionCallDetails?: FunctionCall; // Details if the result is a function call
  newTaskDetails?: LLMTask[]; // Details if the result is a new task
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
    usedTokens?: number;
    // the costs used to solve this task...
    inference_costs?: number;
    aiResponse?: ChatCompletionResponse;
    error?: unknown;
  };
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
};
