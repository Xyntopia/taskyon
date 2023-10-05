<template>
  <div class="fit column">
    <div :class="[theme, 'full-height', 'full-width', 'q-pa-md']">
      <!-- Settings Area -->
      <q-expansion-item dense label="Settings" icon="settings">
        <q-input v-model="openAIKey" label="OpenAI Key" />
        <q-toggle v-model="isDarkTheme" label="Dark Theme" />
      </q-expansion-item>

      <q-card-section class="row items-center">
        <div class="shadow-2 bg-grey-3 text-white rounded-borders">
          <div v-for="message, idx in messages" :key="idx"
            :class="message.role === 'assistant' ? 'message bot-message bg-primary' : 'message user-message bg-secondary'">
            {{ message.content }}
          </div>
        </div>
      </q-card-section>

      <q-card-section>
        <q-input v-model="userInput" label="Type your message..." />
        <q-btn label="Send" @click="sendMessage" />
      </q-card-section>
    </div>
  </div>
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

const sendMessage = async () => {
  if (userInput.value.trim() === '') return;

  const userMessage = {
    role: 'user',
    content: userInput.value
  };

  messages.value.push(userMessage);  // Here

  // Getting bot's response and pushing it to messages array
  const botResponseContent = await callOpenAI(userMessage);
};

const openAIKey = ref<string>(localStorage.getItem('openai_key') || '');
const isDarkTheme = ref<boolean>($q.dark.isActive);

watch(isDarkTheme, (newValue) => {
  $q.dark.set(newValue);
});

watch(openAIKey, (newValue) => {
  localStorage.setItem('openai_key', newValue);
});

</script>
