<template>
  <div class="fit column">
    <q-card class="full-height full-width q-pa-md">
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
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import axios from 'axios';

type OpenAIResponse = {
  choices: [
    {
      message: {
        content: string;
      }
    }
  ];
};


const callOpenAI = async (userMessage: string): Promise<string> => {
  const apiKey = localStorage.getItem('openai_key'); // Fetching from local storage

  if (!apiKey) {
    throw new Error('API Key not found in local storage');
  }

  // Constructing the payload based on OpenAI chat endpoint structure
  const payload = {
    messages: [...messages.value, { role: 'user', content: userMessage }]
  };

  const response = await axios.post<OpenAIResponse>('https://api.openai.com/v1/engines/davinci-codex/chat/completions', payload, {
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

</script>
