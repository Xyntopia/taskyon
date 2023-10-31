<template>
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
              message.result?.type == 'FunctionCall' ? 'text-secondary' : '',
            ]"
          >
            <div class="col-auto row justify-begin q-gutter-xs">
              <div v-if="message.status == 'Error'" class="col-auto">
                <q-icon name="warning" color="warning" size="sm"
                  ><q-tooltip class="bg-warning">Error!</q-tooltip>
                </q-icon>
              </div>
              <div v-if="message.result?.type == 'FunctionCall'" class="col">
                <q-icon size="sm" name="build_circle" />
                {{ message.result.functionCallDetails?.name }}({{
                  message.result.functionCallDetails?.arguments
                }})
              </div>
              <div v-else-if="message.role == 'function'" class="col">
                <q-expansion-item
                  :icon="message.status == 'Error' ? 'warning' : 'calculate'"
                  :label="message.context?.function?.name"
                  :header-class="
                    message.status == 'Error' ? 'text-red' : 'text-green'
                  "
                >
                  <ToolWidget :task="message" />
                </q-expansion-item>
              </div>
              <q-markdown
                class="col"
                v-else-if="message.content"
                :src="message.content"
              />
              <div style="font-size: xx-small" class="column items-center">
                <q-icon
                  name="monetization_on"
                  size="xs"
                  :color="message.debugging?.usedTokens ? 'secondary' : 'info'"
                ></q-icon>
                <q-tooltip :delay="1000">
                  <TokenUsage :message="message" />
                </q-tooltip>
                <div v-if="message.debugging?.usedTokens">
                  {{ message.debugging?.usedTokens }}
                </div>
                <div v-else>
                  {{ estimateChatTokens(message, state.chatState).total }}
                </div>
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
              ['Open', 'In Progress'].some((subs) =>
                subs.includes(
                  state.chatState.Tasks[state.chatState.selectedTaskId || '']
                    ?.status
                )
              )
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
          <div class="row items-center">
            <q-btn
              class="q-ma-md"
              label="toggle all tools"
              @click="toggleSelectedTools"
            />
            <q-option-group
              class="q-ma-md"
              v-model="selectedTools"
              :options="
                Object.keys(tools).map((name) => ({
                  label: name,
                  value: name,
                  description: tools[name].description,
                }))
              "
              color="secondary"
              type="checkbox"
              inline
              dense
            >
              <template v-slot:label="opt">
                <div>
                  {{ opt.label }}
                </div>
                <q-tooltip anchor="bottom middle" style="max-width: 500px">{{
                  opt.description
                }}</q-tooltip>
              </template></q-option-group
            >
          </div>
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
              <a href="https://platform.openai.com/docs/models" target="_blank"
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
                    modelLookUp.openrouter[state.chatState.openrouterAIModel]
                      ?.pricing?.prompt
                  }}
                </div>
                <div>
                  completion:
                  {{
                    modelLookUp.openrouter[state.chatState.openrouterAIModel]
                      ?.pricing?.completion
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
import ToolWidget from 'components/ToolWidget.vue';
import {
  sendMessage,
  taskChain,
  run,
  availableModels,
  Model,
  getBackendUrls,
  getApikey,
  countStringTokens,
  estimateChatTokens,
} from 'src/modules/chat';
import { tools } from 'src/modules/tools';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import openrouterModules from 'assets/openrouter_models.json';
import { useTaskyonStore } from 'stores/taskyonState';
import openaiModels from 'assets/openai_models.json';
import TokenUsage from 'components/TokenUsage.vue';

const openrouterModels: Model[] = openrouterModules.data;
const openAiModels: Model[] = openaiModels.data;

const $q = useQuasar();

const state = useTaskyonStore();

const resOpenRouter = ref<Model[]>([]);
const resOpenAI = ref<Model[]>([]);
async function fetchModels(): Promise<void> {
  try {
    resOpenRouter.value = await availableModels(
      getBackendUrls('openrouter'),
      state.chatState.openRouterAIApiKey
    );
  } catch (error) {
    console.error('Error fetching models:', error);
    console.log('using default list');
    resOpenRouter.value = openrouterModels;
  }
  try {
    resOpenAI.value = await availableModels(
      getBackendUrls('openai'),
      state.chatState.openAIApiKey
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

$q.dark.set(state.darkTheme);

const selectedConversation = computed(() => {
  if (state.chatState.selectedTaskId) {
    const conversationIDChain = taskChain(
      state.chatState.selectedTaskId,
      state.chatState.Tasks
    );
    const conversation = conversationIDChain.map((tId) => {
      return state.chatState.Tasks[tId];
    });
    return conversation;
  } else {
    return [];
  }
});

const estimatedTokens = computed(() => {
  // Tokenize the message
  const tokens = countStringTokens(state.userInput);

  // Return the token count
  return tokens;
});

const selectedTools = ref<string[]>([]);

function toggleSelectedTools() {
  if (selectedTools.value.length > 0) {
    selectedTools.value = [];
  } else {
    selectedTools.value = Object.keys(tools);
  }
}

function sendMessageWrapper() {
  const allowedFunctions = selectedTools.value;
  void sendMessage(state.userInput.trim(), state.chatState, allowedFunctions);
  state.userInput = '';
}

function editTask(taskId: string) {
  state.userInput = state.chatState.Tasks[taskId].content || '';
  state.chatState.selectedTaskId = state.chatState.Tasks[taskId].parentID;
}

const checkForShiftEnter = (event: KeyboardEvent) => {
  if (event.shiftKey && event.key === 'Enter') {
    void sendMessageWrapper();
    // Prevent a new line from being added to the input (optional)
    event.preventDefault();
  }
};

function toggleMessageDebug(id: string) {
  if (state.messageVisualization[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.messageVisualization[id] = true;
  } else {
    // If it does exist, toggle the boolean.
    state.messageVisualization[id] = !state.messageVisualization[id];
  }
}

void run(state.chatState);
</script>
