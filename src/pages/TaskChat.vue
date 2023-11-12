<template>
  <q-page>
    <q-card
      class="col column chat-timeline"
      flat
      v-if="selectedThread.length > 0"
    >
      <!-- "Task" Display -->
      <q-card-section class="q-gutter-sm">
        <div
          v-for="task in selectedThread"
          :key="task.id"
          :class="[
            $q.dark.isActive ? 'bg-primary' : 'bg-white',
            'rounded-borders',
            'q-pa-xs',
            'shadow-2',
            'column',
            'justify-between',
            task.role === 'user' ? 'not-assistant-message' : '',
            task.role === 'user' ? 'q-ml-lg' : '',
          ]"
        >
          <!--Message Display-->
          <div class="col-auto row justify-begin q-gutter-xs">
            <!--task icon-->
            <div v-if="task.state == 'Error'" class="col-auto">
              <q-icon name="warning" color="warning" size="sm"
                ><q-tooltip class="bg-warning">Error!</q-tooltip>
              </q-icon>
            </div>
            <div v-if="task.role == 'function'" class="col">
              <q-expansion-item
                dense
                icon="calculate"
                :label="task.context?.function?.name"
                :header-class="
                  task.state == 'Error' ? 'text-red' : 'text-green'
                "
              >
                <ToolResultWidget :task="task" />
              </q-expansion-item>
            </div>
            <q-markdown
              class="col"
              v-else-if="task.content"
              :src="task.content"
            />
            <!--task costs-->
            <div
              v-if="state.showCosts"
              style="font-size: xx-small"
              class="column items-center"
            >
              <div v-if="task.debugging.taskCosts">
                {{
                  Math.round(task.debugging.taskCosts * 1e6).toLocaleString()
                }}
                μ$
              </div>
              <q-icon
                name="monetization_on"
                size="xs"
                :color="
                  task.debugging.taskCosts
                    ? 'secondary'
                    : task.debugging.promptTokens
                    ? 'positive'
                    : 'info'
                "
              ></q-icon>
              <div v-if="task.debugging?.promptTokens">
                {{ task.debugging?.promptTokens }}
              </div>
              <div v-else>
                {{ estimateChatTokens(task, state.chatState).total }}
              </div>
              <q-tooltip :delay="1000">
                <TokenUsage :task="task" />
              </q-tooltip>
            </div>
          </div>
          <!--buttons-->
          <div
            v-if="state.expertMode"
            class="col-auto q-gutter-xs row justify-start items-stretch"
          >
            <q-separator vertical class="q-my-xs" />
            <q-btn
              class="col-auto rotate-180"
              push
              size="sm"
              outline
              icon="alt_route"
              dense
              @click="state.chatState.selectedTaskId = task.id"
            >
              <q-tooltip :delay="1000"
                >Start alternative conversation thread from here</q-tooltip
              >
            </q-btn>
            <q-btn
              class="col"
              flat
              icon="code"
              dense
              size="sm"
              @click="toggleMessageDebug(task.id)"
            >
              <q-tooltip :delay="1000">Show message context</q-tooltip>
            </q-btn>
            <q-btn
              class="col-auto"
              outline
              icon="edit"
              dense
              size="sm"
              @click="editTask(task.id)"
            >
              <q-tooltip :delay="1000">Edit Task/Message</q-tooltip>
            </q-btn>
          </div>
          <!--task debugging-->
          <q-slide-transition>
            <div v-show="state.messageDebug[task.id]">
              <q-separator />
              <q-card-section class="text-subtitle2">
                <div>Task data:</div>
                <textarea
                  :value="JSON.stringify(task, null, 2)"
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
                  ?.state
              )
            )
          "
          class="q-pa-xs"
        >
          <q-spinner-comment color="secondary" size="lg" />
        </div>
      </q-card-section>
    </q-card>
    <q-card class="col welcome-message" v-else>
      <q-card-section class="column items-center"
        ><q-card-section
          ><q-img
            width="150px"
            alt="Quasar logo"
            src="~assets/taskyon.svg"
          ></q-img>
        </q-card-section>
        <div class="text-h6">
          Welcome! Just type a message below to start using Taskyon!
        </div>
      </q-card-section>
    </q-card>
    <!--Create new task area-->
    <q-card
      :class="$q.dark.isActive ? 'bg-primary' : 'bg-grey-2'"
      flat
      v-if="getApikey(state.chatState)"
    >
      <CreateNewTask />
    </q-card>
    <!--API Key hint-->
    <q-card flat v-else>
      <q-card-section>
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
import ToolResultWidget from 'components/ToolResultWidget.vue';
import { getApikey, estimateChatTokens } from 'src/modules/chat';
import { taskChain } from 'src/modules/taskManager';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import CreateNewTask from 'components/CreateNewTask.vue';
import { LLMTask } from 'src/modules/types';
import axios from 'axios';

const welcomeText = ref<string>('');

void axios.get('main_content/frontpage.md').then((jsonconfig) => {
  welcomeText.value = jsonconfig.data as string;
});

const $q = useQuasar();

const state = useTaskyonStore();
$q.dark.set(state.darkTheme);

const selectedThread = computed(() => {
  if (state.chatState.selectedTaskId) {
    const threadIDChain = taskChain(
      state.chatState.selectedTaskId,
      state.chatState.Tasks
    );
    const thread = threadIDChain.map((tId) => {
      return state.chatState.Tasks[tId];
    });
    return thread;
  } else {
    return [];
  }
});

function editTask(taskId: string) {
  const jsonTask = JSON.stringify(state.chatState.Tasks[taskId]);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const task: Partial<LLMTask> = JSON.parse(jsonTask);
  task.id = 'draft';
  task.debugging = {};
  task.childrenIDs = [];
  task.state = 'Open';
  delete task.result;
  state.taskDraft = task;
  state.chatState.selectedTaskId = state.chatState.Tasks[taskId].parentID;
}

function toggleMessageDebug(id: string) {
  if (state.messageDebug[id] === undefined) {
    // If the message ID doesn't exist, default to true since we're opening it.
    state.messageDebug[id] = true;
  } else {
    // If it does exist, toggle the boolean.
    state.messageDebug[id] = !state.messageDebug[id];
  }
}
</script>
