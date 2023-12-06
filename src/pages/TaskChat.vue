<template>
  <q-page
    :class="[
      $q.dark.isActive ? 'black' : 'primarylight',
      'column items-center',
    ]"
  >
    <q-resize-observer @resize="onResize" :debounce="50" />
    <div
      class="column items-center"
      :style="`padding-bottom: ${bottomPadding}px;`"
      ref="taskThreadContainer"
    >
      <q-scroll-observer @scroll="onScroll" axis="vertical" :debounce="500" />
      <!-- "Task" Display -->
      <q-card
        style="background-color: inherit; color: inherit; max-width: 48rem"
        flat
        square
        v-if="selectedThread.length > 0"
      >
        <q-card-section v-if="currentTask" class="q-gutter-sm scrollCard">
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
                subs.includes(currentTask?.state || '')
              )
            "
          >
            <q-chat-message bg-color="primary" text-color="white">
              <div>
                <div>
                  <q-markdown
                    no-line-numbers
                    :src="currentTask.debugging.streamContent"
                  />
                  <q-markdown
                    no-line-numbers
                    :src="
                      JSON.stringify(
                        currentTask.debugging.toolStreamArgsContent
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
      <div v-else class="col welcome-message column items-center q-pa-xl">
        <div class="col-auto">
          <q-img
            width="150px"
            alt="Quasar logo"
            src="~assets/taskyon.svg"
          ></q-img>
        </div>
        <div class="text-h6 col-auto" v-if="getApikey(state.chatState)">
          Welcome! Just type a message below to start using Taskyon!
        </div>
        <div class="text-h6 col-auto" v-else>
          Welcome to Taskyon! To get started you need to add your API keys to an
          LLM in the settings!
        </div>
      </div>
    </div>
    <!--Create new task area-->
    <q-page-sticky
      position="bottom"
      :offset="[0, 0]"
      expand
      class="col z-top print-hide"
    >
      <q-resize-observer
        @resize="
          (size) => {
            bottomPadding = size.height;
          }
        "
      />
      <div class="col" style="max-width: 48rem">
        <CreateNewTask
          v-if="getApikey(state.chatState)"
          :class="[
            $q.dark.isActive ? 'bg-primary' : 'bg-grey-2',
            'rounded-borders',
            'q-pa-xs',
            'shadow-5',
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
    <!--Bottom scroll button-->
    <q-page-sticky
      v-if="!lockBottomScroll"
      position="bottom-right"
      :offset="[10, bottomPadding + 5]"
      class="print-hide"
    >
      <q-btn
        outline
        icon="keyboard_double_arrow_down"
        color="secondary"
        @click="scrollToThreadEnd"
        size="md"
      >
        <q-tooltip> Scroll To Bottom </q-tooltip>
      </q-btn>
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
import { ref, UnwrapRef, watch } from 'vue';
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
import { getTaskManager } from 'boot/taskyon';
import { LLMTask } from 'src/modules/types';
const { getScrollHeight, getScrollTarget, setVerticalScrollPosition } = scroll;

const welcomeText = ref<string>('');
const bottomPadding = ref(100);
const lockBottomScroll = ref(true); // State to track if the user is at the bottom of scroll page
const taskThreadContainer = ref<HTMLElement | undefined>();
const currentTask = ref<LLMTask>();
const $q = useQuasar();
const state = useTaskyonStore();
$q.dark.set(state.darkTheme);
const selectedThread = ref<LLMTask[]>([]);

async function updateCurrentTask(taskId: string | undefined) {
  if (taskId) {
    currentTask.value = await (await getTaskManager()).getTask(taskId);
  }
}
void updateCurrentTask(state.chatState.selectedTaskId);
watch(() => state.chatState.selectedTaskId, updateCurrentTask);

function onScroll(
  details: UnwrapRef<{
    direction: string;
    position: { top: number };
    delta: { top: number };
  }>
) {
  //  const currentPosition = getVerticalScrollPosition(scrollTargetDomElement); // returns a Number (pixels);
  //const taskThreadArea = document.getElementsByClassName('taskThreadArea')[0];
  if (taskThreadContainer.value) {
    //const el = document.querySelector(id)
    //const el = document.getElementsByClassName()
    const scrollTargetElement = getScrollTarget(taskThreadContainer.value);
    const target = getScrollHeight(scrollTargetElement);
    const scrollEnd = target - (scrollTargetElement as Window).innerHeight;
    //const scrollHeight = getScrollHeight(scrollTargetDomElement); // returns a Number
    //const currentPos = getVerticalScrollPosition(scrollTargetElement);
    const bottomTolerance = 10;
    if (
      details.direction === 'down' &&
      scrollEnd - details.position.top < bottomTolerance
    ) {
      lockBottomScroll.value = true;
      //console.log('lock bottom scroll!', lockBottomScroll.value);
    } else if (
      details.direction === 'up' &&
      scrollEnd - details.position.top > bottomTolerance + 20
    ) {
      //console.log('release bottom lock!');
      lockBottomScroll.value = false;
    }
  }
}

function onResize() {
  if (lockBottomScroll.value) {
    //console.log('scroll to bottom');
    scrollToThreadEnd();
  }
}

function scrollToThreadEnd() {
  const offset = document.body.scrollHeight - window.innerHeight;
  const duration = 300;
  lockBottomScroll.value = true;
  setVerticalScrollPosition(window, offset, duration);
}

void axios.get('main_content/frontpage.md').then((jsonconfig) => {
  welcomeText.value = jsonconfig.data as string;
});

async function updateTaskThread(taskId: string | undefined) {
  if (taskId) {
    const threadIDChain = await taskChain(taskId, async (taskId) =>
      (await getTaskManager()).getTask(taskId)
    );
    const TM = await getTaskManager();
    const thread = (await Promise.all(
      threadIDChain.map(async (tId) => {
        return await TM.getTask(tId);
      })
    )) as LLMTask[];
    selectedThread.value = thread;
  } else {
    selectedThread.value = [];
  }
}

void updateTaskThread(state.chatState.selectedTaskId);
watch(() => state.chatState.selectedTaskId, updateTaskThread);
</script>
