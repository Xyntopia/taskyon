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
      :class="[$q.dark.isActive ? 'bg-primary' : 'bg-grey-3']"
    >
      <q-list class="q-pa-xs">
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
        <q-toggle
          v-model="state.expertMode"
          label="Expert Mode"
          left-label
          color="secondary"
        />
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
              v-model="state.chatState.ApiKey"
              label="API Key"
              hint="Can either be OpenAI key or openrouter.ai key."
            />
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
                v-for="message in selectedConversation"
                :key="message.id"
                :class="[
                  $q.dark.isActive ? 'bg-primary' : 'bg-white',
                  'rounded-borders',
                  'q-pa-xs',
                  'shadow-2',
                  'column',
                  'justify-between',
                  message.role === 'user' ? 'not-assistant-message' : '',
                  message.role === 'user' ? 'q-ml-lg' : '',
                  message.result?.type == 'FunctionCall'
                    ? 'text-secondary'
                    : '',
                ]"
              >
                <div class="col-auto row justify-begin">
                  <div v-if="message.status == 'Error'" class="q-pa-xs">
                    <q-icon name="warning" color="warning" size="sm"
                      ><q-tooltip class="bg-warning">Error!</q-tooltip>
                    </q-icon>
                  </div>
                  <div v-if="message.result?.type == 'FunctionCall'">
                    <q-icon size="sm" name="build_circle" />
                    {{ message.result.functionCallDetails?.name }}({{
                      message.result.functionCallDetails?.arguments
                    }})
                  </div>
                  <div v-else-if="message.role == 'function'">
                    <q-expansion-item
                      :icon="
                        message.status == 'Error' ? 'warning' : 'calculate'
                      "
                      :label="message.context?.function?.name"
                      :header-class="
                        message.status == 'Error' ? 'text-red' : 'text-green'
                      "
                    >
                      <q-list dense bordered>
                        <q-item
                          v-if="isString(message.context?.function?.arguments)"
                        >
                          <q-item-section>
                            <q-item-label>
                              <pre>
                              {{ message.context?.function?.arguments }}
                              </pre>
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                        <q-item
                          v-else
                          v-for="(arg, idx) in message.context?.function
                            ?.arguments || ''"
                          :key="idx"
                        >
                          <q-item-section class="text-bold" side>
                            <q-item-label> {{ idx }}: </q-item-label>
                          </q-item-section>
                          <q-item-section>
                            <q-item-label>
                              <pre>
                              {{ arg }}
                            </pre
                              >
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                        <q-item>
                          <q-item-section>
                            <q-item-label class="text-bold">
                              result:
                            </q-item-label>
                            <q-item-label>
                              <pre>
                              {{ dump(message.result) }}
                              </pre>
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                      </q-list>
                    </q-expansion-item>
                  </div>
                  <q-markdown
                    v-else-if="message.content"
                    :src="message.content"
                  />
                </div>
                <div
                  v-if="state.expertMode"
                  class="col-auto q-gutter-xs row justify-start items-stretch"
                >
                  <q-btn
                    v-if="message.debugging?.aiResponse?.usage"
                    class="col-auto"
                    flat
                    stretch
                    dense
                    stack
                    :ripple="false"
                    :label="message.debugging?.aiResponse?.usage.total_tokens"
                    icon="monetization_on"
                    size="xs"
                    ><q-tooltip :delay="1000"
                      >Number of tokens used for this task</q-tooltip
                    ></q-btn
                  >
                  <q-separator
                    v-if="message.debugging?.aiResponse?.usage"
                    vertical
                    class="q-my-xs"
                  />
                  <q-btn
                    class="col-auto rotate-180"
                    push
                    size="sm"
                    outline
                    icon="alt_route"
                    dense
                    @click="state.chatState.selectedTaskId = message.id"
                  >
                    <q-tooltip :delay="1000"
                      >Start alternative conversation from here</q-tooltip
                    >
                  </q-btn>
                  <q-btn
                    class="col"
                    flat
                    icon="code"
                    dense
                    size="sm"
                    @click="toggleMessageDebug(message.id)"
                  >
                    <q-tooltip :delay="1000">Show message context</q-tooltip>
                  </q-btn>
                </div>
                <q-slide-transition>
                  <div v-show="state.messageVisualization[message.id]">
                    <q-separator />
                    <q-card-section class="text-subtitle2">
                      <div>Task data:</div>
                      <textarea
                        :value="JSON.stringify(message, null, 2)"
                        readonly
                        wrap="soft"
                        style="
                          width: 100%;
                          height: 200px;
                          background-color: inherit;
                          color: inherit;
                        "
                      >
                      </textarea>
                    </q-card-section>
                  </div>
                </q-slide-transition>
              </div>
            </q-card-section>

            <q-card-section v-if="state.chatState.ApiKey">
              <q-input
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
              <q-select
                class="q-pt-xs"
                filled
                dense
                label="Select LLM"
                icon="smart_toy"
                :options="modelOptions"
                emit-value
                v-model="state.chatState.defaultModel"
              >
                <template v-slot:hint>
                  For a list of supported models go here:
                  https://openrouter.ai/docs#models
                </template>
                <template v-slot:after>
                  <div style="font-size: 0.5em">
                    <div>
                      prompt:
                      {{
                        modelLookUp[state.chatState.defaultModel]?.pricing
                          ?.prompt
                      }}
                    </div>
                    <div>
                      completion:
                      {{
                        modelLookUp[state.chatState.defaultModel]?.pricing
                          ?.completion
                      }}
                    </div>
                  </div>
                </template>
              </q-select>
            </q-card-section>
            <q-card-section v-else>
              <div>
                Add an OpenAI API key to access the chatbot in Settings on the
                left side!
                <q-btn
                  href="https://platform.openai.com/account/api-keys"
                  target="_blank"
                >
                  https://platform.openai.com/account/api-keys</q-btn
                >
                or here:
                <q-btn href="https://openrouter.ai/keys" target="_blank">
                  https://openrouter.ai/keys</q-btn
                >
              </div>
            </q-card-section>
          </q-card>
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
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import VecStoreUploader from 'components/VecStoreUploader.vue';
import {
  defaultChatState,
  sendMessage,
  taskChain,
  run,
  availableModels,
  Model,
} from 'src/modules/chat';
import { dump } from 'js-yaml';
import { syncStateWLocalStorage } from 'src/modules/saveState';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';

const $q = useQuasar();

const initialState = {
  chatState: defaultChatState(),
  userInput: '',
  expertMode: false,
  drawerOpen: false,
  drawerRight: false,
  debugMessageExpand: {},
  darkTheme: 'auto' as boolean | 'auto',
  messageVisualization: {} as Record<string, boolean>, // whether message with ID should be open or not...
};

const state = syncStateWLocalStorage('chat_window_state', initialState);

const modelOptions = ref<{ label: string; value: string }[]>([]);
const modelLookUp = ref<Record<string, Model>>({});
void availableModels(state.value.chatState).then((res) => {
  modelOptions.value = res
    .map((m) => {
      const p = parseFloat(m.pricing.prompt);
      const c = parseFloat(m.pricing.completion);
      return { m, p: p + c };
    })
    .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
    .map(({ m }) => ({
      label: `${m.id}: ${m.pricing.prompt}/${m.pricing.completion}`,
      value: m.id,
    }));
  modelLookUp.value = res.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>);
});

$q.dark.set(state.value.darkTheme);

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

function isString(value: unknown) {
  return typeof value === 'string';
}

const selectedConversation = computed(() => {
  if (state.value.chatState.selectedTaskId) {
    const conversationIDChain = taskChain(
      state.value.chatState.selectedTaskId,
      state.value.chatState.Tasks
    );
    const conversation = conversationIDChain.map((tId) => {
      return state.value.chatState.Tasks[tId];
    });
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
  void sendMessage(state.value.userInput.trim(), state.value.chatState);
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

void run(state.value.chatState);
</script>
