<template>
  <q-layout>
    <q-header
      elevated
      :class="$q.dark.isActive ? 'bg-secondary' : 'bg-primary'"
    >
      <q-toolbar>
        <q-btn
          flat
          @click="state.drawerOpen = !state.drawerOpen"
          round
          dense
          icon="menu"
        />
        <q-toolbar-title
          >Chat: Conversation
          {{ state.chatState.selectedConversationID }}</q-toolbar-title
        >
      </q-toolbar>
    </q-header>

    <!-- Sidebar -->
    <q-drawer
      v-model="state.drawerOpen"
      show-if-above
      :width="300"
      :breakpoint="500"
      bordered
      :class="$q.dark.isActive ? 'bg-primary' : 'bg-grey-3'"
    >
      <q-list>
        <!-- Upload Area -->
        <q-expansion-item
          v-if="true"
          label="Upload"
          icon="upload"
          default-opened
        >
          <VecStoreUploader class="fit-height" />
          <!--
          <iframe id="vexvault" style="border: none" :src="uploaderURL" height="200"></iframe>
          -->
        </q-expansion-item>
        <q-separator spaced />
        <!-- Conversation Area -->
        <q-expansion-item
          dense
          label="Conversations"
          icon="folder"
          default-opened
        >
          <div class="column items-stretch">
            <q-btn dense flat icon="add" @click="createNewConversation"></q-btn>
            <q-list>
              <q-item
                dense
                v-for="(conversation, idx) in state.chatState.conversations"
                :key="idx"
                @click="state.chatState.selectedConversationID = idx"
                clickable
                v-ripple
              >
                <q-item-section avatar>
                  <q-icon name="chat_bubble" size="xs" />
                </q-item-section>
                <q-item-section> Conversation {{ idx }} </q-item-section>
                <q-item-section side>
                  <q-btn
                    dense
                    flat
                    icon="delete"
                    size="xs"
                    @click="delete state.chatState.conversations[idx]"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>
        <q-separator spaced />
        <!-- Settings Area -->
        <q-expansion-item dense label="Settings" icon="settings">
          <div class="q-pa-md q-gutter-md">
            <q-input
              placeholder="Add OpenAI API key here!"
              label-color="white"
              dense
              filled
              v-model="state.chatState.openAIKey"
              label="OpenAI Key"
            />
            <div>
              set theme:
              <q-btn-toggle
                dense
                :toggle-color="$q.dark.isActive ? 'secondary' : 'bg-grey-3'"
                :model-value="$q.dark.mode"
                @update:modelValue="
                  (value) => {
                    $q.dark.set(value);
                    state.darkTheme = value;
                  }
                "
                label="Dark Theme"
                :options="[
                  { label: 'Auto', value: 'auto' },
                  { label: 'Light', value: false },
                  { label: 'Dark', value: true },
                ]"
              />
            </div>
          </div>
        </q-expansion-item>
      </q-list>
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <q-page class="fit column">
        <div class="full-height full-width q-pa-md">
          <q-card flat v-if="selectedConversation">
            <q-card-section class="row items-center">
              <div class="q-gutter-sm">
                <div
                  v-for="(message, idx) in selectedConversation"
                  :key="idx"
                  :class="[
                    message.role === 'assistant'
                      ? $q.dark.isActive
                        ? 'bg-primary'
                        : 'bg-white'
                      : 'bg-secondary',
                    'rounded-borders',
                    'q-pa-xs',
                    'shadow-2',
                    'row',
                    'justify-between',
                    message.role === 'assistant' ? 'q-mr-lg' : 'q-ml-lg',
                  ]"
                >
                  <div class="col">
                    {{ message.content }}
                  </div>
                  <div class="col-auto row justify-center">
                    <q-btn flat icon="code">
                      <q-tooltip :delay="1000">Show message context</q-tooltip>
                    </q-btn>
                  </div>
                  <q-slide-transition>
                    <div v-show="true">
                      <q-separator />
                      <q-card-section class="text-subtitle2">
                        {{ message }}
                      </q-card-section>
                    </div>
                  </q-slide-transition>
                </div>
              </div>
            </q-card-section>

            <q-card-section>
              <q-input
                v-if="state.chatState.openAIKey"
                autogrow
                filled
                color="secondary"
                v-model="state.userInput"
                label="Type your message..."
                @keyup="checkForShiftEnter"
              >
                <template v-slot:append>
                  <q-icon
                    v-if="state.userInput !== ''"
                    name="close"
                    @click="state.userInput = ''"
                    class="cursor-pointer"
                  />
                  <q-btn
                    flat
                    dense
                    stretch
                    icon="send"
                    @click="sendMessageWrapper"
                  />
                </template>
              </q-input>
              <div v-else>
                Add an OpenAI API key to access the chatbot in Settings on the
                left side!
                <q-btn
                  href="https://platform.openai.com/account/api-keys"
                  target="_blank"
                >
                  https://platform.openai.com/account/api-keys</q-btn
                >
              </div>
            </q-card-section>
          </q-card>
          <div v-else>
            <q-btn
              label="create new conversion"
              icon="add"
              @click="createNewConversation"
            ></q-btn>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useQuasar, LocalStorage } from 'quasar';
import VecStoreUploader from 'components/VecStoreUploader.vue';
import { chatState, updateChatState, sendMessage } from 'src/modules/chat';
import { syncStateWLocalStorage } from 'src/modules/saveState';

const $q = useQuasar();

const initialState = {
  chatState,
  userInput: '',
  drawerOpen: true,
  debugMessageExpand: {},
  darkTheme: 'auto' as boolean | 'auto',
};

const state = syncStateWLocalStorage('chat_window_state', initialState);

$q.dark.set(state.value.darkTheme);

watch(
  () => state.value.chatState,
  (newState) => {
    updateChatState(newState);
  },
  {
    deep: true,
  }
);

//const uploaderURL = 'http://www.vexvault.com'
//const uploaderURL='http://localhost:8080'

const selectedConversation = computed(() => {
  return state.value.chatState.conversations[
    state.value.chatState.selectedConversationID
  ];
});

function createNewConversation() {
  console.log('start');

  // Get all existing conversation IDs and convert them to integers
  const existingIds = Object.keys(state.value.chatState.conversations).map(
    (id) => parseInt(id, 10)
  );

  // Find the maximum existing ID
  const maxId = Math.max(...existingIds, 0); // Starst at 0 if there are no existing IDs

  // Generate a new unique ID by incrementing the max ID
  const newId = (maxId + 1).toString();

  // Create a new conversation with the unique ID
  state.value.chatState.conversations[newId] = [];

  state.value.chatState.selectedConversationID = newId;
}

function sendMessageWrapper() {
  void sendMessage(state.value.userInput);
  state.value.userInput = '';
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void sendMessageWrapper();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};
</script>
