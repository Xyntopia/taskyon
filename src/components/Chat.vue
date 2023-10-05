<template>
  <q-layout view="hHh Lpr lff">
    <q-header elevated :class="$q.dark.isActive ? 'bg-secondary' : 'bg-primary'">
      <q-toolbar>
        <q-btn flat @click="state.drawerOpen = !state.drawerOpen" round dense icon="menu" />
        <q-toolbar-title>Chat: Conversation {{ state.selectedConversationID }}</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer v-model="state.drawerOpen" show-if-above :width="300" :breakpoint="500" bordered
      :class="$q.dark.isActive ? 'bg-primary' : 'bg-grey-3'">
      <div class="q-gutter-lg">
        <!-- Conversation Area -->
        <q-expansion-item dense label="Conversations" icon="folder" default-opened>
          <div class="column items-stretch">
            <q-btn dense flat icon="add" @click="createNewConversation"></q-btn>
            <q-list>
              <q-item dense v-for="(conversation, idx) in state.conversations" :key="idx"
                @click="state.selectedConversationID = idx" clickable v-ripple>
                <q-item-section avatar>
                  <q-icon name="chat_bubble" size="xs" />
                </q-item-section>
                <q-item-section>
                  Conversation {{ idx }}
                </q-item-section>
                <q-item-section side>
                  <q-btn dense flat icon="delete" size="xs" />
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>
        <!-- Settings Area -->
        <q-expansion-item dense label="Settings" icon="settings">
          <div class="q-pa-md">
            <q-input dense filled v-model="state.openAIKey" label="OpenAI Key" />
            <q-toggle :color="$q.dark.isActive ? 'secondary' : 'bg-grey-3'" v-model="isDarkTheme" label="Dark Theme" />
          </div>
        </q-expansion-item>
      </div>
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <q-page class="fit column">
        <div class="full-height full-width q-pa-md">
          <div v-if="selectedConversation">
            <q-card-section class="row items-center">
              <div class="q-gutter-sm">
                <div v-for="message, idx in selectedConversation" :key="idx" :class="[message.role === 'assistant' ? ($q.dark.isActive ? 'bg-primary' : 'bg-white') : 'bg-secondary',
                  'rounded-borders', 'q-pa-xs', 'shadow-2',
                message.role === 'assistant' ? 'q-mr-lg' : 'q-ml-lg']">
                  {{ message.content }}
                </div>
              </div>
            </q-card-section>

            <q-card-section>
              <q-input autogrow filled color="secondary" v-model="state.userInput" label="Type your message..."
                @keyup="checkForShiftEnter">
                <template v-slot:append>
                  <q-icon v-if="state.userInput !== ''" name="close" @click="state.userInput = ''"
                    class="cursor-pointer" />
                  <q-btn flat dense stretch icon="send" @click="sendMessage" />
                </template>
              </q-input>
            </q-card-section>
          </div>
          <div v-else>
            <q-btn label="create new conversion" icon="add" @click="createNewConversation"></q-btn>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>


<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useQuasar, LocalStorage } from 'quasar';
import axios from 'axios';
import { StampAnnotationElement } from 'pdfjs-dist/types/src/display/annotation_layer';

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

const stateName = "chat_state";
const state = ref({
  conversations: {} as Record<string, OpenAIMessage[]>,
  selectedConversationID: '',
  openAIKey: 'add open AI key here!!',
  userInput: '',
  drawerOpen: true
})


const storedState = LocalStorage.getItem(stateName);
if (storedState) {
  state.value = JSON.parse(
    storedState as string
  ) as typeof state.value;
}

const isDarkTheme = ref<boolean>($q.dark.isActive);

const selectedConversation = computed(() => {
  return state.value.conversations[state.value.selectedConversationID];
})

function createNewConversation() {
  // Get all existing conversation IDs and convert them to integers
  const existingIds = Object.keys(state.value.conversations).map(id => parseInt(id, 10));

  // Find the maximum existing ID
  const maxId = Math.max(...existingIds, 0);  // Starst at 0 if there are no existing IDs

  // Generate a new unique ID by incrementing the max ID
  const newId = (maxId + 1).toString();

  // Create a new conversation with the unique ID
  state.value.conversations[newId] = [];

  state.value.selectedConversationID = newId
}

const callOpenAI = async (userMessage: OpenAIMessage): Promise<string> => {
  // Prepare the payload, including all the messages from the chat history
  const payload = {
    model: 'gpt-3.5-turbo',
    messages: selectedConversation.value
  };

  const response = await axios.post<OpenAIResponse>('https://api.openai.com/v1/chat/completions', payload, {
    headers: {
      'Authorization': `Bearer ${state.value.openAIKey}`,
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
    state.value.userInput = ''
    // Getting bot's response and pushing it to messages array
    await callOpenAI(userMessage);
  }
};

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void sendMessage();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};

watch(isDarkTheme, (newValue) => {
  $q.dark.set(newValue);
});

watch(() => state, (newValue) => {
  LocalStorage.set(stateName, JSON.stringify(newValue.value));
}, {
  deep: true,
});

</script>
