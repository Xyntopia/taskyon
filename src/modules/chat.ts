import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';
import axios from 'axios';
import 

export let chatState = {
  conversations: {} as Record<string, OpenAIMessage[]>,
  selectedConversationID: '',
  openAIKey: '',
};

/**
 * Updates the chat state with a new value.
 *
 * @param {typeof chatState} newValue - The new value for the chat state.
 */
export function updateChatState(newValue: typeof chatState) {
  chatState = newValue;
}

export type OpenAIResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: [
    {
      index: number;
      message: {
        role: 'assistant';
        content: string;
      };
      finish_reason: string;
    }
  ];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type OpenAIMessage = {
  role: string;
  content: string;
};

const vectorStore = useVectorStore();

/**
 * Searches the vector store with a given term and returns k results.
 *
 * @param {string} searchTerm - The term to search for.
 * @param {number} k - The number of results to return.
 * @returns {Promise<SearchResult[]>} - A promise that resolves to an array of search results.
 */
async function searchStore(searchTerm: string, k: number) {
  console.log(`Searching for ${searchTerm}`);
  const searchResults = await vectorStore.query(searchTerm, k);
  console.log(searchResults);
  return searchResults;
}

/**
 * Calls the OpenAI API with a given set of chat messages.
 *
 * @param {OpenAIMessage[]} chatMessages - The chat messages to send to the API.
 * @returns {Promise<string>} - A promise that resolves to the bot's response content.
 */
async function callOpenAI(chatMessages: OpenAIMessage[]) {
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: chatMessages,
  };

  const response = await axios.post<OpenAIResponse>(
    'https://api.openai.com/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${chatState.openAIKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const botResponseContent = response.data?.choices[0]?.message?.content ?? '';
  return botResponseContent;
}

function activeConversation() {
  return chatState.conversations[chatState.selectedConversationID];
}

type Tool = {
  description: string;
  fullDescription: string;
  func: (params: any) => void; // Consider being more specific with 'any' if possible
};

type ToolCollection = {
  [key: string]: Tool;
};

const tools: ToolCollection = {
  tool1: {
    description: 'Short description of tool1.',
    fullDescription: 'Detailed description of tool1.',
    func: function (params: number) {
      console.log('tool 2');
    },
  },
  tool2: {
    description: 'Short description of tool2.',
    fullDescription: 'Detailed description of tool2.',
    func: function (params: string) {
      console.log('tool 1');
    },
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
    msgs.push({
      role: 'user',
      content: `# Overall objective: \n${objective}\n\n`,
    });

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
    let msg = `# Considering the overall objective: \n${objective}\n\n`;

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

function generateContext(context: string): OpenAIMessage {
  return {
    role: 'user',
    content: `# Take into account this context\n\n${context} \n\n`,
  };
}

export const sendMessage = async (message: string) => {
  const conversation = activeConversation();
  if (message.trim() === '' || !conversation) return;

  // Check for null before accessing messages property
  if (conversation) {
    // Insert tool summary message
    const toolSummaryMessage = {
      role: 'system',
      content: generateToolSummary(),
    };
    
    const searchTerm = message
    const k=3
    console.log(`Searching for ${searchTerm}`);
    const context = await vectorStore.query(searchTerm, k)
    console.log(context)

    const contextMessage = {
      role: 'system',
      content: generateContext(context),
    };

    const userMessage = {
      role: 'user',
      content: message,
    };

    conversation.push(userMessage);
    // Getting bot's response and pushing it to messages array
    const botResponseContent = await callOpenAI([
      toolSummaryMessage,
      contextMessage,
      ...conversation,
    ]);
    // Add the bot's response to the existing messages array
    conversation.push({
      role: 'assistant',
      content: botResponseContent,
    });
  }
};
