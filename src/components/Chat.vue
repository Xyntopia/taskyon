<template>
  <q-layout view="hHh Lpr lff">
    <q-header elevated :class="$q.dark.isActive ? 'bg-secondary' : 'bg-black'">
      <q-toolbar>
        <q-btn flat @click="state.drawerOpen = !state.drawerOpen" round dense icon="menu" />
        <q-toolbar-title>Chat</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer v-model="state.drawerOpen" show-if-above :width="200" :breakpoint="500" bordered
      :class="$q.dark.isActive ? 'bg-grey-9' : 'bg-grey-3'">
      <q-list>
        <q-item v-for="(conversation, idx) in state.conversations" :key="idx" @click="state.selectedConversationID = idx">
          <q-item-section>
            Conversation {{ idx + 1 }}
          </q-item-section>
        </q-item>
      </q-list>
      <!-- Settings Area -->
      <q-expansion-item dense label="Settings" icon="settings">
        <q-input v-model="state.openAIKey" label="OpenAI Key" />
        <q-toggle v-model="isDarkTheme" label="Dark Theme" />
      </q-expansion-item>
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <q-page class="fit column">
        <div class="full-height full-width q-pa-md">
          <q-card-section class="row items-center">
            <div v-if="selectedConversation" class="q-gutter-sm">
              <div v-for="message, idx in selectedConversation" :key="idx" :class="[message.role === 'assistant' ? 'bg-primary' : 'bg-secondary',
                'rounded-borders', 'q-pa-xs', 'shadow-2']">
                {{ message.content }}
              </div>
            </div>
          </q-card-section>

          <q-card-section>
            <q-input autogrow filled color="secondary" v-model="state.userInput" label="Type your message...">
              <template v-slot:append>
                <q-icon v-if="state.userInput !== ''" name="close" @click="state.userInput = ''" class="cursor-pointer" />
                <q-btn flat dense stretch icon="send" @click="sendMessage" />
              </template>
            </q-input>
          </q-card-section>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>


<script setup lang="ts">
import { ref, watch, computed, watchEffect } from 'vue';
import { useQuasar, LocalStorage } from 'quasar';
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

const state = ref({
  conversations: {} as Record<string, OpenAIMessage[]>,
  selectedConversationID: '',
  openAIKey: 'add open AI key here!!',
  userInput: '',
  drawerOpen: true
})

const isDarkTheme = ref<boolean>($q.dark.isActive);

const selectedConversation = computed(() => {
  return state.value.conversations[state.value.selectedConversationID];
}
)

const callOpenAI = async (userMessage: OpenAIMessage): Promise<string> => {
  const apiKey = localStorage.getItem('openai_key'); // Fetching from local storage

  if (!apiKey) {
    throw new Error('API Key not found in local storage');
  }

  // Prepare the payload, including all the messages from the chat history
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: selectedConversation.value
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
  selectedConversation.value.push({ role: 'assistant', content: botResponseContent });

  return botResponseContent;
};

const sendMessage = async () => {
  if (state.value.userInput.trim() === '' || !selectedConversation.value) return;

  const userMessage = {
    role: 'user',
    content: state.value.userInput
  };

  // Check for null before accessing messages property
  if (selectedConversation.value) {
    selectedConversation.value.push(userMessage);

    // Getting bot's response and pushing it to messages array
    const botResponseContent = await callOpenAI(userMessage);
  }
};

watch(isDarkTheme, (newValue) => {
  $q.dark.set(newValue);
});

watch(() => state, (newValue) => {
  LocalStorage.set('chat_state', JSON.stringify(newValue.value));
}, {
  deep: true,
});

</script>
