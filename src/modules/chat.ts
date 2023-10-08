import VecStoreUploader from 'components/VecStoreUploader.vue';
import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';
import axios from 'axios';

export let chatState = {
  conversations: {} as Record<string, OpenAIMessage[]>,
  selectedConversationID: '',
  openAIKey: 'add open AI key here!!',
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

export const sendMessage = async (message: string) => {
  const conversation = activeConversation();
  if (message.trim() === '' || !conversation) return;

  const userMessage = {
    role: 'user',
    content: message,
  };

  // Check for null before accessing messages property
  if (conversation) {
    activeConversation().push(userMessage);
    // Getting bot's response and pushing it to messages array
    const botResponseContent = await callOpenAI(conversation);
    // Add the bot's response to the existing messages array
    conversation.push({
      role: 'assistant',
      content: botResponseContent,
    });
  }
};
