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
          {{ state.chatState.selectedTaskId }}</q-toolbar-title
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
          icon="list"
          default-opened
        >
          <div class="column items-stretch">
            <q-btn dense flat icon="add" @click="createNewConversation"></q-btn>
            <q-list>
              <q-item
                dense
                v-for="(conversationId, idx) in conversationIDs"
                :key="idx"
                @click="state.chatState.selectedTaskId = conversationId"
                clickable
                v-ripple
              >
                <q-item-section avatar>
                  <q-icon name="chat_bubble" size="xs" />
                </q-item-section>
                <q-item-section> Conversation {{ idx }} </q-item-section>
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

    <!-- Sidebar Right -->
    <q-drawer
      side="right"
      v-model="state.drawerRight"
      bordered
      :width="200"
      :breakpoint="500"
    >
      <q-scroll-area class="fit">
        <div class="q-pa-sm">
          <div v-for="n in 50" :key="n">Drawer {{ n }} / 50</div>
        </div>
      </q-scroll-area>
    </q-drawer>

    <!-- Main Content Area -->
    <q-page-container>
      <q-page class="fit column">
        <div class="full-height full-width q-pa-xs">
          <q-card flat v-if="selectedConversation">
            <!-- "Task" Display -->
            <q-card-section class="q-gutter-sm">
              <div
                v-for="(message, idx) in selectedConversation"
                :key="idx"
                :class="[
                  $q.dark.isActive ? 'bg-primary' : 'bg-white',
                  'rounded-borders',
                  'q-pa-xs',
                  'shadow-2',
                  'row',
                  'justify-between',
                  message.role === 'user' ? 'not-assistant-message' : '',
                  message.role === 'user' ? 'q-ml-lg' : '',
                  message.result?.type == 'FunctionCall'
                    ? 'text-secondary'
                    : '',
                ]"
              >
                <div class="col">
                  <div v-if="message.result?.type == 'FunctionCall'">
                    <q-icon size="sm" name="build_circle" />
                    {{ message.result.functionCallDetails?.name }}({{
                      message.result.functionCallDetails?.arguments
                    }})
                  </div>
                  <div v-else-if="message.role == 'function'">
                    <div>
                      <q-icon size="md" name="calculate" />
                      <q-icon size="md" name="check" color="positive" />
                      {{ message.context?.function?.name }}
                    </div>
                  </div>
                  <q-markdown
                    v-else-if="message.content"
                    :src="message.content"
                  />
                </div>
                <div class="col-auto row justify-center">
                  <q-btn
                    flat
                    icon="code"
                    dense
                    @click="toggleMessageDebug(message.id)"
                  >
                    <q-tooltip :delay="1000">Show message context</q-tooltip>
                  </q-btn>
                </div>
                <q-slide-transition>
                  <div v-show="state.messageVisualization[message.id]">
                    <q-separator />
                    <q-card-section class="text-subtitle2">
                      {{ message }}
                    </q-card-section>
                  </div>
                </q-slide-transition>
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

<style lang="sass">
/* Define the CSS class for the orange "glow" shadow */
.not-assistant-message
  box-shadow: inset 0 0 5px $secondary
  border-radius: 5px
</style>

<script setup lang="ts">
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
import { watch, computed } from 'vue';
import { useQuasar } from 'quasar';
import VecStoreUploader from 'components/VecStoreUploader.vue';
import {
  chatState,
  updateChatState,
  sendMessage,
  taskChain,
  run,
} from 'src/modules/chat';
import { syncStateWLocalStorage } from 'src/modules/saveState';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';

const $q = useQuasar();

const initialState = {
  chatState,
  userInput: '',
  drawerOpen: false,
  drawerRight: false,
  debugMessageExpand: {},
  darkTheme: 'auto' as boolean | 'auto',
  messageVisualization: {} as Record<string, boolean>, // whether message with ID should be open or not...
};

const state = syncStateWLocalStorage('chat_window_state', initialState);
updateChatState(state.value.chatState);

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

const conversationIDs = computed(() => {
  // extract all "top-level tasks" (orphan tasks) which
  // represent the start of conversations...
  const orphanTasks = Object.values(state.value.chatState.Tasks)
    .filter((t) => {
      return t.childrenIDs.length == 0;
    })
    .map((t) => t.id);
  return orphanTasks;
});

const selectedConversation = computed(() => {
  if (state.value.chatState.selectedTaskId) {
    const conversationIDChain = taskChain(state.value.chatState.selectedTaskId);
    const conversation = conversationIDChain.map((tId) => chatState.Tasks[tId]);
    return conversation;
  } else {
    return [];
  }
});

function createNewConversation() {
  console.log('start a new conversation (create an "orphan task")');
  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.value.chatState.selectedTaskId = undefined;
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

function toggleMessageDebug(id: string) {
  if (state.value.messageVisualization[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.value.messageVisualization[id] = true;
  } else {
    // If it does exist, toggle the boolean.
    state.value.messageVisualization[id] =
      !state.value.messageVisualization[id];
  }
}

void run();
</script>
