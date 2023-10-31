import { LLMTask } from './taskManager';
import { FunctionCall } from './tools';

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
  };
};export interface TaskResult {
  type: 'ChatAnswer' | 'FunctionCall' | 'NewTask' | 'FunctionResult'; // Type of result
  content?: string; // Description or value of the result
  functionCallDetails?: FunctionCall; // Details if the result is a function call
  newTaskDetails?: LLMTask[]; // Details if the result is a new task
}

