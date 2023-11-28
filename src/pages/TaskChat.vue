<template>
  <q-page>
    <q-card
      :class="$q.dark.isActive ? 'black' : 'primarylight'"
      flat
      square
      v-if="selectedThread.length > 0"
    >
      <!-- "Task" Display -->
      <q-card-section class="q-gutter-sm">
        <q-chat-message
          v-for="task in selectedThread"
          :sent="task.role === 'user' ? true : false"
          :key="task.id"
          :bg-color="$q.dark.isActive ? 'primary' : 'white'"
          :class="task.role === 'user' ? 'user-message' : ''"
        >
          <div :class="$q.dark.isActive ? 'text-white' : 'text-black'">
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
                v-else-if="task.content"
                class="col"
                :plugins="[markdownItMermaid, addCopyButtons]"
                :src="task.content"
                @click="handleMarkdownClick"
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
                <div v-if="task.debugging.promptTokens">
                  {{ task.debugging.promptTokens }}
                </div>
                <div v-else>
                  {{
                    (task.debugging.estimatedTokens?.promptTokens || 0) +
                    (task.debugging.estimatedTokens?.resultTokens || 0)
                  }}
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
              <q-btn
                class="col"
                flat
                icon="code"
                dense
                size="sm"
                @click="toggleMessageDebug(task.id)"
              >
                <q-tooltip :delay="0">Show message context</q-tooltip>
              </q-btn>
              <q-btn
                class="col-auto rotate-180"
                push
                size="sm"
                outline
                icon="alt_route"
                dense
                @click="state.chatState.selectedTaskId = task.id"
              >
                <q-tooltip :delay="0"
                  >Start alternative conversation thread from here</q-tooltip
                >
              </q-btn>
              <q-btn
                class="col-auto"
                outline
                icon="edit"
                dense
                size="sm"
                @click="editTask(task.id)"
              >
                <q-tooltip :delay="0">Edit Task/Message</q-tooltip>
              </q-btn>
            </div>
            <!--task debugging-->
            <q-slide-transition>
              <div v-show="state.messageDebug[task.id]">
                <q-separator spaced />
                <q-tabs dense v-model="state.messageDebug[task.id]" no-caps>
                  <q-tab name="ERROR" label="Error" />
                  <q-tab name="FOLLOWUPERROR" label="Follow-up task error" />
                  <q-tab name="RAW" label="raw task data" />
                  <q-tab name="RAWTASK" label="task prompt" />
                  <q-tab name="MESSAGECONTENT" label="raw result" />
                </q-tabs>
                <q-tab-panels
                  v-model="state.messageDebug[task.id]"
                  animated
                  swipeable
                  horizontal
                  transition-prev="jump-right"
                  transition-next="jump-left"
                >
                  <q-tab-panel name="ERROR">
                    <textarea
                      :value="JSON.stringify(task.debugging.error, null, 2)"
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
                  </q-tab-panel>
                  <q-tab-panel name="FOLLOWUPERROR">
                    <textarea
                      :value="
                        JSON.stringify(task.debugging.followUpError, null, 2)
                      "
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
                  </q-tab-panel>
                  <q-tab-panel name="RAW">
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
                  </q-tab-panel>
                  <q-tab-panel name="MESSAGECONTENT">
                    <textarea
                      :value="
                        task.result?.chatResponse?.choices[0].message.content ||
                        'ERROR'
                      "
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
                  </q-tab-panel>
                  <q-tab-panel name="RAWTASK">
                    <textarea
                      v-for="(tp, idx) in task.debugging.taskPrompt"
                      :key="idx"
                      :value="typeof tp.content === 'string' ? tp.content : ''"
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
                  </q-tab-panel>
                </q-tab-panels>
              </div>
            </q-slide-transition>
          </div>
        </q-chat-message>
        <div
          v-if="
            ['Open', 'In Progress'].some((subs) =>
              subs.includes(
                state.chatState.Tasks[state.chatState.selectedTaskId || '']
                  ?.state
              )
            )
          "
        >
          <q-chat-message bg-color="primary" text-color="white">
            <div>
              <div>
                <q-markdown
                  :src="
                    state.chatState.Tasks[state.chatState.selectedTaskId || '']
                      .debugging.streamContent || ''
                  "
                />
                <q-spinner-dots size="2rem" />
              </div>
              <div class="row justify-end">
                <q-btn
                  round
                  outline
                  color="secondary"
                  icon="stop"
                  @click="emitCancelCurrentTask"
                >
                  <q-tooltip> Stop processing current task. </q-tooltip>
                </q-btn>
                <q-btn
                  v-if="state.expertMode"
                  round
                  outline
                  color="secondary"
                  icon="block"
                  @click="emitCancelAllTasks"
                  class="q-ml-xs"
                >
                  <q-tooltip> Cancel all tasks. </q-tooltip>
                </q-btn>
              </div>
            </div>
          </q-chat-message>
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

<style lang="sass" scoped>
.user-message
  position: relative
.user-message::after
  content: ''
  position: absolute
  top: 0
  right: 0
  bottom: 0
  width: 5px /* Width of the fading effect */
  background: linear-gradient(to top, rgba(255, 255, 255, 0), $secondary)

.primarylight
  background-color: scale-color($primary, $lightness: 80%)
.primarydark
  background-color: scale-color($primary, $blackness: 30%)

::v-deep(.code-block-with-overlay)
  position: relative

  .copy-button
    position: absolute
    top: 0
    right: 0
    z-index: 10
    // Add other necessary styles for the button
</style>

<script setup lang="ts">
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
import { computed, ref, createVNode, render, h, provide } from 'vue';
import { useQuasar } from 'quasar';
import ToolResultWidget from 'components/ToolResultWidget.vue';
import { getApikey } from 'src/modules/chat';
import { taskChain } from 'src/modules/taskManager';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import TokenUsage from 'components/TokenUsage.vue';
import CreateNewTask from 'components/CreateNewTask.vue';
import { LLMTask } from 'src/modules/types';
import {
  emitCancelAllTasks,
  emitCancelCurrentTask,
} from 'src/modules/taskWorker';
import axios from 'axios';
import type MarkdownIt from 'markdown-it/lib';
import markdownItMermaid from '@datatraccorporation/markdown-it-mermaid';
import { QBtn } from 'quasar';

type markdownItMermaid = MarkdownIt.PluginSimple;

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
    state.messageDebug[id] = 'RAW';
  } else {
    // If it does exist, toggle the boolean.
    state.messageDebug[id] = undefined;
  }
}

let copyButtonCounter = ref(0);

function addCopyButtons(md: MarkdownIt) {
  const defaultFenceRenderer =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => {
      return self.renderToken(tokens, idx, options);
    });

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    // Original rendered HTML of the code block
    const originalRenderedHtml = defaultFenceRenderer(
      tokens,
      idx,
      options,
      env,
      self
    );

    const buttonId = `copy-button-${copyButtonCounter.value++}`;

    // Custom HTML for the button
    const customHtml = `
        <div class="code-block-with-overlay">
          <button class="copy-button q-btn q-btn-item non-selectable transparent q-btn--flat q-btn--rectangle
            q-btn--actionable q-focusable q-hoverable q-btn--dense col-auto copy-button">
            <span class="q-focus-helper"></span>
            <span class="q-btn__content text-center col items-center q-anchor--skip justify-center row">
              <i class="q-icon notranslate material-icons" aria-hidden="true" role="img">content_copy</i>
            </span>
          </button>
          ${originalRenderedHtml}
        </div>
      `;

    return customHtml;
  };
}

function copyToClipboard(code: string) {
  navigator.clipboard
    .writeText(code)
    .then(() => {
      console.log('Copied to clipboard');
    })
    .catch((err) => {
      console.error('Error in copying text: ', err);
    });
}

function handleMarkdownClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.copy-button');
  if (target) {
    // Find the closest .code-block-with-overlay and then find the <code> element inside it
    const codeBlockContainer = target.closest('.code-block-with-overlay');
    if (codeBlockContainer) {
      const codeElement = codeBlockContainer.querySelector('code');
      if (codeElement) {
        const codeText = codeElement.textContent || ''; // Get the text content of the <code> element
        copyToClipboard(codeText);
      }
    }
  }
}
</script>
