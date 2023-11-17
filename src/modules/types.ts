import { FunctionCall } from './tools';
import type OpenAI from 'openai';

export type TaskState =
  | 'Open'
  | 'Queued'
  | 'In Progress'
  | 'Completed'
  | 'Error';

export type OpenAIMessage = {
  // The content of the message, can be null for some messages.
  content: string | null | undefined;
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
  type: 'ChatAnswer' | 'FunctionCall' | 'FunctionResult' | 'FunctionError'; // Type of result
  assistantResponse?: OpenAI.Beta.Threads.Messages.ThreadMessage[];
  chatResponse?: ChatCompletionResponse;
  functionResult?: string; // Description or value of the result
  functionCall?: FunctionCall; // Details if the result is a function call
}

// a mapping which maps a file to the various platforms and storage options
interface FileMapping {
  uuid: string;
  opfs: string;
  openAIFileId: string;
}

export type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null | undefined;
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
  };
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
  created_at?: number; //unix timestamp
};
