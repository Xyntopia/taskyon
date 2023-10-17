import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';
import axios from 'axios';
import { dump } from 'js-yaml';
import { v1 as uuidv1 } from 'uuid';
import { useCachedModels } from './mlModels';
import { functions } from 'lodash';

export let chatState = {
  conversations: {} as Record<string, LLMTask[]>,
  selectedConversationID: '',
  openAIKey: '',
  summaryModel: 'Xenova/distilbart-cnn-6-6',
};

/**
 * Updates the chat state with a new value.
 *
 * @param {typeof chatState} newValue - The new value for the chat state.
 */
export function updateChatState(newValue: typeof chatState) {
  chatState = newValue;
}

const models = useCachedModels();

type Tool = {
  // Description of what the function does (optional).
  description: string;
  // The name of the function to be called.
  name: string;
  // The parameters the function accepts (JSON Schema object).
  parameters: Record<string, any>;
};

export type FunctionCall = {
  // The name of the function to call.
  name: string;
  // Arguments to call the function with in JSON format.
  arguments: string;
};

export type OpenAIMessage = {
  // The content of the message, can be null for some messages.
  content: string | null;
  // Function call details if applicable.
  function_call?: FunctionCall;
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
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type ChatCompletionRequest = {
  // An array of messages in the conversation.
  messages: Array<OpenAIMessage>;
  // The ID of the model to use.
  model: string;
  // Controls how the model calls functions.
  function_call?:
    | 'none'
    | 'auto'
    | {
        // The name of the function to call.
        name: string;
      };
  // Penalty for repeating tokens.
  frequency_penalty?: number | null;
  // Details on how the model calls functions.
  functions?: Array<Tool>;
  // Modify the likelihood of specified tokens.
  logit_bias?: Record<string, number> | null;
  // Maximum number of tokens to generate.
  max_tokens?: number | null;
  // Number of chat completion choices to generate.
  n?: number | null;
  // Penalty for new tokens in the text.
  presence_penalty?: number | null;
  // Sequences to stop generating tokens.
  stop?: string | Array<string> | null;
  // Enable partial message deltas streaming.
  stream?: boolean | null;
  // Sampling temperature for output.
  temperature?: number | null;
  // Probability mass for nucleus sampling.
  top_p?: number | null;
  // Unique identifier for your end-user (optional).
  user?: string;
};

type LLMTask = {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  status: 'Open' | 'In Progress' | 'Completed';
  context?: {
    message?: OpenAIMessage;
    tool?: string; // Name of the tool to use (if any)
    toolParameters?: Record<string, any>; // Parameters for the tool (if any)
  };
  parentID?: string;
  debugging?: Record<string, any>;
  result?: TaskResult;
  id: string;
  allowedTools?: string[];
  authorId?: string;
};

interface TaskResult {
  type: 'ChatAnswer' | 'FunctionCall' | 'NewTask'; // Type of result
  content?: string; // Description or value of the result
  functionCallDetails?: FunctionCall; // Details if the result is a function call
  newTaskDetails?: LLMTask[]; // Details if the result is a new task
}

const vectorStore = useVectorStore();

/**
 * Calls the OpenAI API with a given set of chat messages.
 *
 * @param {OpenAIMessage[]} chatMessages - The chat messages to send to the API.
 * @returns {Promise<string>} - A promise that resolves to the bot's response content.
 */
async function callOpenAI(
  chatMessages: OpenAIMessage[],
  functions: Array<Tool>
) {
  const payload: ChatCompletionRequest = {
    model: 'gpt-3.5-turbo',
    messages: chatMessages,
    functions,
    function_call: functions.length > 0 ? 'auto' : 'none',
    user: 'vexvault',
  };

  const response = await axios.post<ChatCompletionResponse>(
    'https://api.openai.com/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${chatState.openAIKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

function activeConversation() {
  return chatState.conversations[chatState.selectedConversationID];
}

type ToolCollection = {
  [key: string]: Tool;
};

const tools: ToolCollection = {};

tools.localVectorStoreSearch = {
  description:
    'Performs an ANN search in the local vector database from the chat and retrieves the results.',
  name: 'localVectorStoreSearch',
  parameters: {
    type: 'object',
    properties: {
      searchTerm: {
        type: 'string',
        description: 'The search term to use in the vector store search.',
      },
    },
    required: ['searchTerm'],
  },
};

function taskChat(
  task: string,
  context: string | null = null,
  previousTasks: string | null = null,
  objective: string | null = null,
  format = 'yaml',
  method = 'prompt'
) {
  // This function generates a chat prompt for a task. It is used to generate the prompt for the chat interface
  const msgs = [];
  msgs.push({
    role: 'system',
    content:
      'You are a helpful assistant that aims to complete the given task. Do not add any amount of explanatory text.',
  });

  if (method === 'chat') {
    if (objective) {
      msgs.push({
        role: 'user',
        content: `# Overall objective: \n${objective}\n\n`,
      });
    }

    if (previousTasks) {
      msgs.push({
        role: 'user',
        content: `# Take into account these previously completed tasks\n\n${previousTasks} \n\n`,
      });
    }

    if (context) {
      msgs.push({
        role: 'user',
        content: `# Take into account this context\n\n${context} \n\n`,
      });
    }

    // This 'if' will never be true because it's explicitly set to false. It's probably a placeholder for future logic.
    if (false) {
      // code that will never execute
    }

    if (task) {
      msgs.push({
        role: 'user',
        content: `# Complete the following task: \n${task} \n\nProvide only the precise information requested without context, make sure we can parse the response as ${format}. \n\n## RESULT:\n`,
      });
    }
  } else {
    let msg = '';

    if (objective) {
      msg += `# Considering the overall objective: \n${objective}\n\n`;
    }

    if (previousTasks) {
      msg += `# Take into account these previously completed tasks:\n\n${previousTasks} \n\n`;
    }

    if (context) {
      msg += `# Take into account this context:\n\n${context} \n\n`;
    }

    msg += `# Complete the following task: \n${task} \n\nProvide only the precise information requested without context, make sure we can parse the response as ${format}. RESULT:\n`;
    msgs.push({ role: 'user', content: msg });
  }

  return msgs;
}

/*
async function executeTask(task, previousTasks = null, context = null, objective = null, formatting = "yaml", modelId = "ggml-mpt-7b-instruct", maxTokens = 1000) {
  // Creates a message and executes a task with an LLM based on given information
  const msgs = taskChat(task, context ? `\n---\n${context.join("\n---\n")}` : null, previousTasks, objective, formatting);
  let res;
  try {
      // You'll need to define the 'chatCompletion' function, as it's not included in the Python code.
      res = await chatCompletion(msgs, maxTokens, modelId);
  } catch (error) {
      // handle error
      console.error(error);
  }

  let obj;
  if (formatting === "yaml") {
      try {
          // You'll need to use a YAML parsing library here, as JavaScript doesn't have native YAML support.
          obj = YAML.parse(res); // using 'yaml' or another library
      } catch (error) {
          throw new Error(`Could not convert ${res} to yaml: ${error}`);
      }
  } else if (["txt", "markdown"].includes(formatting)) {
      obj = res;
  } else {
      console.warn(`Formatting: ${formatting} is unknown!`);
      // do nothing ;)
  }

  return [obj, msgs, res];
}
*/

function generateToolSummary() {
  return Object.keys(tools)
    .map((toolName) => {
      const { description } = tools[toolName];
      return `${toolName}: ${description}`;
    })
    .join('\n');
}

async function generateContext(
  searchTerm: string
): Promise<OpenAIMessage | undefined> {
  const k = 3;
  console.log(`Searching for ${searchTerm}`);
  const results = await vectorStore.query(searchTerm, k);
  if (results.length > 0) {
    const context = dump(results);
    console.log(context);
    return {
      role: 'user',
      content: `# Take into account this context which was found in 
    our database for the previous message\n\n${context} \n\n`,
    };
  } else {
    return undefined;
  }
}

export const sendMessage = async (message: string) => {
  const conversation = activeConversation();
  if (message.trim() === '' || !conversation) return;

  // Check for null before accessing messages property
  if (conversation) {
    // Insert tool summary message
    /*const toolSummaryMessage = {
      role: 'system',
      content: generateToolSummary(),
    };*/

    console.log('starting to send!');
    const contextMessage = await generateContext(message);

    const currentTask: LLMTask = {
      role: 'user',
      status: 'In Progress',
      content: message,
      context: {
        message: contextMessage,
      },
      result: undefined,
      id: uuidv1(),
      allowedTools: Object.keys(tools),
    };

    conversation.push(currentTask);
    // Getting bot's response and pushing it to messages array
    const openAIConversation = [] as OpenAIMessage[];
    //give a hint on available tools to the AI...
    //openAIConversation.concat(//toolSummaryMessage,)
    openAIConversation.push(
      ...conversation.map((m) => {
        return {
          role: m.role,
          content: m.content,
        };
      })
    );
    // add context to each message of the user!
    /*if (userMessage.data.context) {
      openAIConversation.push(userMessage.data.context);
    }*/

    // add possible functions to the call:
    const functions = currentTask.allowedTools?.map((t) => tools[t]) || [];

    // TODO: check if our response contains a function call and execute that!
    //       then add that to the chat and call OpenAI again, but this time with the result....

    //--------  and perform the inference -------------
    const response = await callOpenAI(openAIConversation, functions);
    currentTask.status = 'Completed';
    // Add the bot's response to the existing messages array
    if (response.choices.length > 0) {
      const choice = response.choices[0];
      const taskChain: LLMTask = {
        status: 'Completed',
        parentID: currentTask.id,
        role: choice.message.role,
        content: choice.message.content,
        debugging: {
          aiResponse: response,
        },
        id: response.id,
      };

      // if we got anything back ;)
      if (choice.message.content) {
        conversation.push(taskChain);
      } else if (
        choice.finish_reason == 'function_call' &&
        choice.message.content == null &&
        choice.message.function_call
      ) {
        taskChain.result = {
          type: 'FunctionCall',
          functionCallDetails: choice.message.function_call,
        };
        conversation.push(taskChain);
      } else {
        console.log("We don't know what to do with this response:", response);
      }
    }
  }
};
