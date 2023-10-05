<template>
  <q-layout view="hHh Lpr lff">
    <q-header elevated :class="$q.dark.isActive ? 'bg-secondary' : 'bg-black'">
      <q-toolbar>
        <q-btn flat @click="drawerOpen = !drawerOpen" round dense icon="menu" />
        <q-toolbar-title>Chat</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer v-model="drawerOpen" show-if-above :width="200" :breakpoint="500" bordered
      :class="$q.dark.isActive ? 'bg-grey-9' : 'bg-grey-3'">
      <q-list>
        <q-item v-for="(conversation, idx) in conversations" :key="idx" @click="selectConversation(idx)">
          <q-item-section>
            Conversation {{ idx + 1 }}
          </q-item-section>
        </q-item>
      </q-list>
      <!-- Settings Area -->
      <q-expansion-item dense label="Settings" icon="settings">
        <q-input v-model="openAIKey" label="OpenAI Key" />
        <q-toggle v-model="isDarkTheme" label="Dark Theme" />
      </q-expansion-item>
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <q-page class="fit column">
        <div class="full-height full-width q-pa-md">
          <q-card-section class="row items-center">
            <div v-if="selectedConversation" class="shadow-2 bg-grey-3 text-white rounded-borders">
              <div v-for="message, idx in selectedConversation.messages" :key="idx"
                :class="message.role === 'assistant' ? 'message bot-message bg-primary' : 'message user-message bg-secondary'">
                {{ message.content }}
              </div>
            </div>
          </q-card-section>

          <q-card-section>
            <q-input autogrow filled color="secondary" v-model="userInput" label="Type your message...">
              <template v-slot:append>
                <q-icon v-if="userInput !== ''" name="close" @click="userInput = ''" class="cursor-pointer" />
                <q-btn flat icon="send" @click="sendMessage" />
              </template>
            </q-input>
          </q-card-section>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>


<script setup lang="ts">
import { ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import axios from 'axios';

const $q = useQuasar();

type OpenAIResponse = {
  id: string,
  object: string,
  created: number,
  model: string,
  choices: [
    {
      index: number,
      message: {
        role: 'assistant',
        content: string
      },
      finish_reason: string
    }
  ],
  usage: {
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number
  }
};

type OpenAIMessage = {
  role: string,
  content: string
}

const messages = ref<OpenAIMessage[]>([]);
const userInput = ref<string>('');
const drawerOpen = ref<boolean>(true);
const conversations = ref<{ id: string, messages: OpenAIMessage[] }[]>([]);
const selectedConversation = ref<{ id: string, messages: OpenAIMessage[] } | null>(null);
const openAIKey = ref<string>(localStorage.getItem('openai_key') || '');
const isDarkTheme = ref<boolean>($q.dark.isActive);
// Initialize with a default conversation if desired
const defaultConversation = { id: '1', messages: [] };
conversations.value.push(defaultConversation);
selectedConversation.value = defaultConversation;


const callOpenAI = async (userMessage: OpenAIMessage): Promise<string> => {
  const apiKey = localStorage.getItem('openai_key'); // Fetching from local storage

  if (!apiKey) {
    throw new Error('API Key not found in local storage');
  }

  // Prepare the payload, including all the messages from the chat history
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: messages.value
  };

  const response = await axios.post<OpenAIResponse>('https://api.openai.com/v1/chat/completions', payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  // Extracting the bot's message from the response
  const botResponseContent = response.data?.choices[0]?.message?.content ?? '';

  // Add the bot's response to the existing messages array
  messages.value.push({ role: 'assistant', content: botResponseContent });

  return botResponseContent;
};

const selectConversation = (idx: number) => {
  selectedConversation.value = conversations.value[idx];
};

const sendMessage = async () => {
  if (userInput.value.trim() === '' || !selectedConversation.value) return;

  const userMessage = {
    role: 'user',
    content: userInput.value
  };

  // Check for null before accessing messages property
  if (selectedConversation.value) {
    selectedConversation.value.messages.push(userMessage);

    // Getting bot's response and pushing it to messages array
    const botResponseContent = await callOpenAI(userMessage);
  }
};

watch(isDarkTheme, (newValue) => {
  $q.dark.set(newValue);
});

watch(openAIKey, (newValue) => {
  localStorage.setItem('openai_key', newValue);
});

</script>
