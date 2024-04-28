<template>
  <!--Task Page-->
  <q-page :class="[$q.dark.isActive ? 'black' : 'primarylight']">
    <q-resize-observer @resize="onResize" :debounce="50" />
    <!--Chat Area-->
    <div
      class="items-center"
      :style="`padding-bottom: ${bottomPadding}px;`"
      ref="taskThreadContainer"
    >
      <q-scroll-observer @scroll="onScroll" axis="vertical" :debounce="500" />
      <!-- "Task" Display -->
      <div
        style="background-color: inherit; color: inherit"
        flat
        square
        v-if="selectedThread.length > 0"
      >
        <div v-if="currentTask" class="q-gutter-xs q-px-xs task-container">
          <div v-for="task in selectedThread" :key="task.id" :class="task.role">
            <Task
              :task="task"
              :class="[
                $q.dark.isActive
                  ? 'bg-primary text-white'
                  : 'bg-white text-black',
                'rounded-borders',
                'q-pa-xs',
                task.role === 'user' ? 'user-message q-pr-sm q-ml-lg' : '',
              ]"
            />
          </div>
          <!--Render tasks which are in progress-->
          <div v-if="['Open', 'In Progress'].includes(currentTask.state)">
            <div
              :class="[
                $q.dark.isActive
                  ? 'bg-primary text-white'
                  : 'bg-white text-black',
                'rounded-borders',
                'row',
              ]"
            >
              <q-btn
                class="q-ma-xs"
                dense
                outline
                color="secondary"
                icon="stop"
                @click="state.taskWorkerController.interrupt(currentTask.id)"
              >
                <q-tooltip> Stop processing current task. </q-tooltip>
              </q-btn>
              <div class="col">
                <q-markdown
                  no-line-numbers
                  :src="currentTask.debugging.streamContent"
                />
                <q-markdown
                  no-line-numbers
                  :src="
                    JSON.stringify(currentTask.debugging.toolStreamArgsContent)
                  "
                />
                <q-spinner-dots size="2rem" color="secondary" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Welcome Message -->
      <div v-else class="col welcome-message column items-center q-pa-xl">
        <div class="col-auto">
          <q-icon
            class="q-pa-xl"
            size="10rem"
            name="svguse:taskyon_mono_opt.svg#taskyon"
          ></q-icon>
          <!--<q-img
            width="150px"
            alt="Quasar logo"
            src="~assets/taskyon_mono.svg"
          ></q-img>-->
        </div>
        <div
          class="text-h6 col-auto text-center"
          v-if="state.keys[state.chatState.selectedApi]"
        >
          Welcome! Just type a message below to start using Taskyon!
        </div>
        <div v-else class="text-h6 col-auto text-center">
          Welcome to Taskyon! To get started you need to add your API keys to an
          LLM in the settings!
        </div>
      </div>
    </div>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand class="print-hide">
      <q-resize-observer
        @resize="
          (size) => {
            bottomPadding = size.height;
          }
        "
      />
      <div class="col q-pa-xs" style="max-width: 48rem">
        <CreateNewTask
          v-if="state.keys[state.chatState.selectedApi]"
          :class="[
            $q.dark.isActive ? 'bg-primary' : 'bg-grey-2',
            'rounded-borders',
            'q-pa-xs',
            'shadow-5',
          ]"
        >
        </CreateNewTask>
        <!--API Key hint-->
        <q-card v-else>
          <q-card-section class="q-gutter-md column">
            <p>
              No API key found for selected API:
              <span class="text-bold">{{ state.chatState.selectedApi }}</span>
              . Either choose a different API by pressing one of the following
              buttons:
              <q-btn
                outline
                dense
                v-for="keyname of Object.keys(state.keys).filter(
                  (k) => state.keys[k]
                )"
                :key="keyname"
                :label="keyname"
                @click="state.chatState.selectedApi = keyname"
              />
            </p>
            <p>Or Generate a new API key:</p>
            <OpenRouterPKCE />
            <div class="row">
              <q-btn
                class="col"
                label="Go to OpenAI"
                outline
                noCaps
                href="https://platform.openai.com/account/api-keys"
                target="_blank"
              />
              <InfoDialog
                info-text="Get an API key from https://openrouter.ai/keys and use it for inference tasks"
              />
            </div>
            <div class="row">
              <q-btn
                class="col"
                label="Access keys via OpenRouter Dashboard"
                outline
                noCaps
                href="https://openrouter.ai/keys"
                target="_blank"
              />
              <InfoDialog
                info-text="Get an API key from https://www.openrouter.ai and use it for inference tasks"
              />
            </div>
          </q-card-section>
          <q-card-section>
            If getting keys manually, add them to settings manually:
            <q-btn
              class="q-mx-sm"
              dense
              to="/settings"
              label="settings"
              icon="settings"
            ></q-btn>
          </q-card-section>
        </q-card>
      </div>
    </q-page-sticky>
    <!--Task controller buttons-->
    <q-page-sticky
      v-if="currentTask && ['Open', 'In Progress'].includes(currentTask.state)"
      position="bottom-left"
      :offset="[10, bottomPadding + 5]"
      class="print-hide"
    >
      <q-btn
        fab-mini
        class="scroll-to-bottom-button"
        icon="stop"
        size="md"
        @click="state.taskWorkerController.interrupt(currentTask.id)"
      >
        <q-tooltip> Stop processing current task. </q-tooltip>
      </q-btn>
    </q-page-sticky>
    <!--Bottom scroll button-->
    <q-page-sticky
      v-if="!lockBottomScroll"
      position="bottom-right"
      :offset="[10, bottomPadding + 5]"
      class="print-hide"
    >
      <q-btn
        fab-mini
        class="scroll-to-bottom-button"
        icon="keyboard_double_arrow_down"
        @click="scrollToThreadEnd"
        size="md"
      >
        <q-tooltip> Scroll To Bottom </q-tooltip>
      </q-btn>
    </q-page-sticky>
  </q-page>
</template>

<style lang="sass" scoped>
.scroll-to-bottom-button
  background-color: rgba($primary, .7) // Adjust the alpha value as needed
  color: white

.task-container
  display: flex
  flex-direction: column
  max-width: 800px
  margin: 0 auto // Centers the container

  // Default style for all tasks
  > div
    width: fit-content // Makes the width of the task as small as its content
    max-width: 99% // Prevents the task from growing beyond the container width
    box-sizing: border-box // Ensures padding and borders are included in width calculation
    align-self: flex-start // Aligns to the left by default

  // Specific style for tasks with the 'user' role
  .user
    align-self: flex-end // Aligns to the right




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
import { taskChain } from 'src/modules/taskyon/taskManager';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import OpenRouterPKCE from 'src/components/OpenRouterPKCE.vue';
import InfoDialog from 'src/components/InfoDialog.vue';
import axios from 'axios';
import { getTaskManager } from 'boot/taskyon';
import { LLMTask } from 'src/modules/taskyon/types';
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
