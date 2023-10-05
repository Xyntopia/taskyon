<template>
  <div class="fit column">
    <div :class="[theme, 'full-height', 'full-width', 'q-pa-md']">
      <!-- Settings Area -->
      <q-expansion-item label="Settings" icon="settings">
        <q-input v-model="openAIKey" label="OpenAI Key" />
        <q-toggle v-model="isDarkTheme" label="Dark Theme" />
      </q-expansion-item>

      <q-card-section class="row items-center">
        <div class="shadow-2 bg-grey-3 text-white rounded-borders">
          <div v-for="message in messages" :key="message.id"
            :class="message.type === 'bot' ? 'message bot-message bg-primary' : 'message user-message bg-secondary'">
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


<style lang="sass" scoped>
$dark-theme-color: $primary
$light-theme-color: white

.dark-theme
  background-color: $dark-theme-color
  color: #fff

.light-theme
  background-color: $light-theme-color
  color: #333
</style>



<script setup lang="ts">
import { ref, watch } from 'vue';
import axios from 'axios';

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



const callOpenAI = async (userMessage: string): Promise<string> => {
  const apiKey = localStorage.getItem('openai_key'); // Fetching from local storage

  if (!apiKey) {
    throw new Error('API Key not found in local storage');
  }

  // Constructing the payload based on OpenAI chat endpoint structure
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: [
      ...messages.value,
      { role: 'user', content: userMessage }
    ]
  };


  const response = await axios.post<OpenAIResponse>('https://api.openai.com/v1/chat/completions', payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });


  // Extracting the bot's message from the response
  return response.data?.choices[0]?.message?.content ?? '';
};

const messages = ref<Array<{ id: number, type: 'user' | 'bot', content: string }>>([]);
const userInput = ref<string>('');

const sendMessage = async () => {
  if (userInput.value.trim() === '') return;

  const userMessage = {
    id: Date.now(),
    type: 'user',
    content: userInput.value
  };

  messages.value.push(userMessage);

  // Getting bot's response and pushing it to messages array
  const botResponseContent = await callOpenAI(userInput.value);
  messages.value.push({ id: Date.now() + 1, type: 'bot', content: botResponseContent });

  userInput.value = '';
};

const openAIKey = ref<string>(localStorage.getItem('openai_key') || '');
const isDarkTheme = ref<boolean>(false);
const theme = ref<string>('light-theme');

watch(isDarkTheme, (newValue) => {
  theme.value = newValue ? 'dark-theme' : 'light-theme';
});

watch(openAIKey, (newValue) => {
  localStorage.setItem('openai_key', newValue);
});

</script>
