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
          dense
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
            <div class="row">
              <q-btn
                class="col"
                dense
                flat
                icon="add"
                @click="createNewConversation"
              ></q-btn>
              <q-btn dense flat icon="delete" @click="deleteAllTasks"
                ><q-tooltip :delay="500"
                  >Delete all conversations!</q-tooltip
                ></q-btn
              >
            </div>
            <q-list>
              <q-item
                dense
                v-for="(conversationId, idx) in conversationIDs"
                :key="conversationId"
                @click="state.chatState.selectedTaskId = conversationId"
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
                    icon="delete"
                    size="sm"
                    flat
                    @click="deleteConversation(conversationId, state.chatState)"
                  ></q-btn>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>
        <q-separator spaced />
        <!-- Settings Area -->
        <q-expansion-item dense label="Settings" icon="settings" default-opened>
          <div class="q-pa-sm q-gutter-md">
            <q-btn-toggle
              v-model="state.chatState.baseURL"
              no-caps
              rounded
              unelevated
              bordered
              outline
              toggle-color="secondary"
              color="white"
              text-color="black"
              :options="[
                { label: 'OpenAI API', value: getBackendUrls('openai') },
                {
                  label: 'Openrouter.ai API',
                  value: getBackendUrls('openrouter'),
                },
              ]"
            />
            <q-input
              placeholder="Add API key here!"
              label-color="white"
              dense
              filled
              v-model="state.chatState.openRouterAIApiKey"
              label="Openrouter.ai API key"
            />
            <q-input
              placeholder="Add API key here!"
              label-color="white"
              dense
              filled
              v-model="state.chatState.openAIApiKey"
              label="OpenAI API Key"
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
                <div class="col-auto row justify-begin q-gutter-xs">
                  <div v-if="message.status == 'Error'" class="col-auto">
                    <q-icon name="warning" color="warning" size="sm"
                      ><q-tooltip class="bg-warning">Error!</q-tooltip>
                    </q-icon>
                  </div>
                  <div
                    v-if="message.result?.type == 'FunctionCall'"
                    class="col"
                  >
                    <q-icon size="sm" name="build_circle" />
                    {{ message.result.functionCallDetails?.name }}({{
                      message.result.functionCallDetails?.arguments
                    }})
                  </div>
                  <div v-else-if="message.role == 'function'" class="col">
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
                    class="col"
                    v-else-if="message.content"
                    :src="message.content"
                  />
                  <div
                    v-if="message.debugging?.usedTokens"
                    style="font-size: xx-small"
                    class="column items-center"
                  >
                    <q-icon
                      name="monetization_on"
                      size="xs"
                      color="secondary"
                    ></q-icon>
                    <q-tooltip :delay="1000">Tokens used</q-tooltip>
                    <div>{{ message.debugging?.usedTokens }}</div>
                  </div>
                  <div
                    v-else-if="message.debugging?.estimatedTokens"
                    style="font-size: xx-small"
                    class="column items-center"
                  >
                    <q-icon
                      name="monetization_on"
                      size="xs"
                      color="info"
                    ></q-icon
                    ><q-tooltip :delay="1000">Prompt token estimate</q-tooltip>
                    <div>{{ message.debugging?.estimatedTokens }}</div>
                  </div>
                  <div
                    v-if="message.debugging?.aiResponse?.usage"
                    class="column items-center"
                    style="font-size: xx-small"
                  >
                    <q-icon
                      name="monetization_on"
                      size="xs"
                      color="secondary"
                    ></q-icon
                    ><q-tooltip :delay="1000"
                      >Number of tokens used:
                      <div>
                        {{ message.debugging?.aiResponse?.usage.prompt_tokens }}
                        +{{
                          message.debugging?.aiResponse?.usage.completion_tokens
                        }}
                        ={{ message.debugging?.aiResponse?.usage.total_tokens }}
                      </div></q-tooltip
                    >{{ message.debugging?.aiResponse?.usage.total_tokens }}
                  </div>
                </div>
                <div
                  v-if="state.expertMode"
                  class="col-auto q-gutter-xs row justify-start items-stretch"
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
                  <q-btn
                    class="col-auto"
                    outline
                    icon="edit"
                    dense
                    size="sm"
                    @click="editTask(message.id)"
                  >
                    <q-tooltip :delay="1000">Edit user Message</q-tooltip>
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
              <div
                v-if="
                  state.chatState.Tasks[state.chatState.selectedTaskId || '']
                    ?.status == 'Open'
                "
                class="q-pa-xs"
              >
                <q-spinner-comment color="secondary" size="lg" />
              </div>
            </q-card-section>

            <!--Create new task area-->
            <q-card-section v-if="getApikey(state.chatState)">
              <q-input
                autogrow
                filled
                color="secondary"
                v-model="state.userInput"
                :hint="`Estimated number of tokens: ${estimatedTokens}`"
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
                v-if="state.chatState.baseURL == getBackendUrls('openai')"
                class="q-pt-xs"
                filled
                bottom-slots
                dense
                label="Select Openrouter.ai LLM"
                icon="smart_toy"
                :options="modelOptions.openrouter"
                emit-value
                v-model="state.chatState.openAIModel"
              >
                <template v-slot:hint>
                  For a list of supported models go here:
                  <a
                    href="https://platform.openai.com/docs/models"
                    target="_blank"
                    >https://platform.openai.com/docs/models</a
                  >
                </template>
              </q-select>
              <q-select
                v-else
                class="q-pt-xs"
                filled
                dense
                bottom-slots
                label="Select OpenAI LLM"
                icon="smart_toy"
                :options="modelOptions.openai"
                emit-value
                v-model="state.chatState.openrouterAIModel"
              >
                <template v-slot:hint>
                  For a list of supported models go here:
                  <a href="https://openrouter.ai/docs#models" target="_blank"
                    >https://openrouter.ai/docs#models</a
                  >
                </template>
                <template v-slot:after>
                  <div style="font-size: 0.5em">
                    <div>
                      prompt:
                      {{
                        modelLookUp.openrouter[
                          state.chatState.openrouterAIModel
                        ]?.pricing?.prompt
                      }}
                    </div>
                    <div>
                      completion:
                      {{
                        modelLookUp.openrouter[
                          state.chatState.openrouterAIModel
                        ]?.pricing?.completion
                      }}
                    </div>
                  </div>
                </template>
              </q-select>
            </q-card-section>
            <q-card-section v-else>
              <div>
                Add an API key to access a chatbot in Settings on the left side!
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
  deleteConversation,
  getBackendUrls,
  getApikey,
  countStringTokens,
} from 'src/modules/chat';
import { dump } from 'js-yaml';
import { syncStateWLocalStorage } from 'src/modules/saveState';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
const openrouterModels: Model[] = openrouterModules.data;
import openaiModels from 'assets/openai_models.json';
const openAiModels: Model[] = openaiModels.data;

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

const resOpenRouter = ref<Model[]>([]);
const resOpenAI = ref<Model[]>([]);
async function fetchModels(): Promise<void> {
  try {
    resOpenRouter.value = await availableModels(
      getBackendUrls('openrouter'),
      state.value.chatState.openRouterAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    console.log('using default list');
    resOpenRouter.value = openrouterModels;
  }
  try {
    resOpenAI.value = await availableModels(
      getBackendUrls('openai'),
      state.value.chatState.openAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    resOpenAI.value = openAiModels;
  }
}

const modelOptions = computed(() => ({
  openai: resOpenRouter.value
    .map((m) => {
      const p = parseFloat(m.pricing?.prompt || '');
      const c = parseFloat(m.pricing?.completion || '');
      return { m, p: p + c };
    })
    .sort(({ p: p1 }, { p: p2 }) => p1 - p2)
    .map(({ m }) => ({
      label: `${m.id}: ${m.pricing?.prompt || 'N/A'}/${
        m.pricing?.completion || 'N/A'
      }`,
      value: m.id,
    })),
  openrouter: [...resOpenAI.value]
    .sort((m1, m2) => m1.id.localeCompare(m2.id))
    .map((m) => ({
      label: `${m.id}`,
      value: m.id,
    })),
}));

const modelLookUp = computed(() => ({
  openai: resOpenAI.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
  openrouter: resOpenRouter.value.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, Model>),
}));

void fetchModels();

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

function deleteAllTasks() {
  state.value.chatState.selectedTaskId = undefined;
  state.value.chatState.Tasks = {};
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
  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.value.chatState.selectedTaskId = undefined;
}

const estimatedTokens = computed(() => {
  // Tokenize the message
  const tokens = countStringTokens(state.value.userInput);

  // Return the token count
  return tokens;
});

function sendMessageWrapper() {
  void sendMessage(state.value.userInput.trim(), state.value.chatState);
  state.value.userInput = '';
}

function editTask(taskId: string) {
  state.value.userInput = state.value.chatState.Tasks[taskId].content || '';
  state.value.chatState.selectedTaskId =
    state.value.chatState.Tasks[taskId].parentID;
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
