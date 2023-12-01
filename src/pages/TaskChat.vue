<template>
  <q-page
    :class="[
      $q.dark.isActive ? 'black' : 'primarylight',
      'column items-center',
    ]"
  >
    <div
      class="column items-center"
      :style="`padding-bottom: ${bottomPadding}px;`"
    >
      <!-- "Task" Display -->
      <q-card
        style="background-color: inherit; color: inherit; max-width: 48rem"
        flat
        square
        v-if="selectedThread.length > 0"
      >
        <q-card-section class="q-gutter-sm">
          <q-chat-message
            v-for="task in selectedThread"
            :sent="task.role === 'user' ? true : false"
            :key="task.id"
            :bg-color="$q.dark.isActive ? 'primary' : 'white'"
            :class="task.role === 'user' ? 'user-message' : ''"
          >
            <Task
              :task="task"
              :class="$q.dark.isActive ? 'text-white' : 'text-black'"
            />
          </q-chat-message>
          <!--Render tasks which are in progress-->
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
                    no-line-numbers
                    :src="
                      state.chatState.Tasks[
                        state.chatState.selectedTaskId || ''
                      ].debugging.streamContent || ''
                    "
                  />
                  <q-markdown
                    no-line-numbers
                    :src="
                      JSON.stringify(
                        state.chatState.Tasks[
                          state.chatState.selectedTaskId || ''
                        ].debugging.toolStreamArgsContent
                      )
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
      <!-- Welcome Message -->
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
    </div>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" class="z-top">
      <q-resize-observer
        @resize="
          (size) => {
            bottomPadding = size.height;
          }
        "
      />
      <div>
        <CreateNewTask
          v-if="getApikey(state.chatState)"
          :class="[
            $q.dark.isActive ? 'bg-primary' : 'bg-grey-2',
            'rounded-borders',
            'q-pa-xs','shadow-5'
          ]"
        >
        </CreateNewTask>
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
      </div>
    </q-page-sticky>
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
</style>

<script setup lang="ts">
import Task from 'components/Task.vue';
import { QMarkdown } from '@quasar/quasar-ui-qmarkdown';
import { computed, ref } from 'vue';
import { useQuasar, scroll } from 'quasar';
import { getApikey } from 'src/modules/chat';
import { taskChain } from 'src/modules/taskManager';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import {
  emitCancelAllTasks,
  emitCancelCurrentTask,
} from 'src/modules/taskWorker';
import axios from 'axios';
const { getScrollHeight } = scroll;

const bottomPadding = ref(100);

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

function scrollToThreadEnd() {
  getScrollHeight(scrollTargetDomElement); // returns a Number
}
</script>
