import VecStoreUploader from 'components/VecStoreUploader.vue';
import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';
import axios from 'axios';

// Define an interface for chatState
interface IChatState {
  conversations: Record<string, OpenAIMessage[]>;
  selectedConversationID: string;
  openAIKey: string;
}

export let chatState = {
  conversations: {} as Record<string, OpenAIMessage[]>,
  selectedConversationID: '',
  openAIKey: 'add open AI key here!!',
};

export function updateChatState(newValue: typeof chatState){
  chatState = newValue
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

async function searchStore(searchTerm: string, k: number) {
  console.log(`Searching for ${searchTerm}`);
  const searchResults = await vectorStore.query(searchTerm, k);
  console.log(searchResults);
  return searchResults;
}

export async function callOpenAI(chatMessages: OpenAIMessage[]) {
  // Prepare the payload, including all the messages from the chat history
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

  // Extracting the bot's message from the response
  const botResponseContent = response.data?.choices[0]?.message?.content ?? '';

  return botResponseContent;
}
