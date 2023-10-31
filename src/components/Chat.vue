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
                  dense
                  icon="calculate"
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
        <CreateNewTask v-if="getApikey(state.chatState)" />
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
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import ToolWidget from 'components/ToolWidget.vue';
import {
  getApikey,
  estimateChatTokens,
} from 'src/modules/chat';
import {taskChain} from 'src/modules/taskManager'
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import CreateNewTask from 'components/CreateNewTask.vue';

const $q = useQuasar();

const state = useTaskyonStore();
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

function editTask(taskId: string) {
  state.userInput = state.chatState.Tasks[taskId].content || '';
  state.chatState.selectedTaskId = state.chatState.Tasks[taskId].parentID;
}

function toggleMessageDebug(id: string) {
  if (state.messageVisualization[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.messageVisualization[id] = true;
  } else {
    // If it does exist, toggle the boolean.
    state.messageVisualization[id] = !state.messageVisualization[id];
  }
}
</script>
