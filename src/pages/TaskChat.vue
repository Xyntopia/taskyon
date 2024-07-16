<template>
  <!--Task Page-->
  <q-page class="column">
    <q-resize-observer :debounce="50" @resize="onResize" />
    <!--Chat Area-->
    <div
      ref="taskThreadContainer"
      class="col column items-center"
      :style="`padding-bottom: ${bottomPadding}px;`"
    >
      <q-scroll-observer axis="vertical" :debounce="500" @scroll="onScroll" />
      <!-- "Task" Display -->
      <ConversationWidget
        v-if="
          selectedThread.length > 0 &&
          state.llmSettings.selectedApi &&
          state.keys[state.llmSettings.selectedApi]
        "
        :selected-thread="selectedThread"
        :state="state"
        :current-task="currentTask"
        :task-worker-waiting="taskWorkerWaiting"
      />
      <!-- Welcome Message -->
      <div
        v-else
        class="col column justify-center items-center q-pa-sm welcome"
        style="max-width: 600px"
      >
        <q-icon
          class="q-pa-xl"
          size="10rem"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          :color="$q.dark.isActive ? 'secondary' : 'primary'"
        ></q-icon>
        <GetStarted />
      </div>
    </div>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand class="print-hide">
      <q-resize-observer @resize="handleResize" />
      <div class="col q-pa-xs" style="max-width: 48rem">
        <CreateNewTask
          v-if="
            state.llmSettings.selectedApi &&
            state.keys[state.llmSettings.selectedApi]
          "
          :class="[
            $q.dark.isActive ? 'bg-primary2' : 'bg-white',
            'rounded-borders',
            'q-pa-xs',
            'shadow-5',
          ]"
          :force-task-props="state.llmSettings.taskTemplate"
        >
        </CreateNewTask>
      </div>
    </q-page-sticky>
    <!--Task Chat Control Buttons-->
    <q-page-sticky
      position="bottom-right"
      :offset="[10, bottomPadding + 5]"
      class="print-hide"
    >
      <div class="column q-gutter-xs">
        <div class="col-auto">
          <q-btn
            v-if="!state.lockBottomScroll"
            fab-mini
            class="taskyon-control-button"
            :icon="matKeyboardDoubleArrowDown"
            size="md"
            @click="scrollToThreadEnd"
          >
            <q-tooltip> Scroll To Bottom </q-tooltip>
          </q-btn>
        </div>
        <div class="col-auto">
          <q-btn
            v-if="currentTask && !taskWorkerWaiting"
            fab-mini
            class="taskyon-control-button"
            :icon="matStop"
            size="md"
            :color="stoppingTasks ? 'secondary' : 'primary'"
            :loading="stoppingTasks"
            @click="stopTasks"
          >
            <q-tooltip> Stop processing current task. </q-tooltip>
          </q-btn>
        </div>
      </div>
    </q-page-sticky>
  </q-page>
</template>

<script setup lang="ts">
import { ref, UnwrapRef, watch } from 'vue';
import { useQuasar, scroll } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import CreateNewTask from 'components/CreateNewTask.vue';
import type { TaskNode } from 'src/modules/taskyon/types';
import GetStarted from 'src/components/GetStarted.vue';
import {
  matKeyboardDoubleArrowDown,
  matStop,
} from '@quasar/extras/material-icons';
import { sleep } from 'src/modules/taskyon/utils';
import ConversationWidget from 'components/ConversationWidget.vue';
const { getScrollHeight, getScrollTarget, setVerticalScrollPosition } = scroll;

const bottomPadding = ref(100);
const taskThreadContainer = ref<HTMLElement | undefined>();
const $q = useQuasar();
const state = useTaskyonStore();
$q.dark.set(state.darkTheme); // TODO: this needs to go into our taskyon store...
const selectedThread = ref<TaskNode[]>([]);
const taskWorkerWaiting = ref(true);

const currentTask = ref<TaskNode>();
async function updateCurrentTask(taskId: string | undefined) {
  if (taskId) {
    currentTask.value = await (await state.getTaskManager()).getTask(taskId);
  }
  await sleep(100);
  taskWorkerWaiting.value = state.taskWorkerController.isWaiting();
}
void updateCurrentTask(state.llmSettings.selectedTaskId);
watch(() => state.llmSettings.selectedTaskId, updateCurrentTask);

const stoppingTasks = ref(false);
async function stopTasks() {
  console.log('stopping!');
  stoppingTasks.value = true;
  state.taskWorkerController.interrupt(currentTask.value?.id);

  await sleep(1000);
  // Poll every 500ms to check if the task is stopped
  while (!state.taskWorkerController.isWaiting()) {
    console.log('waiting for task to stop...');
    await sleep(100);
  }
  taskWorkerWaiting.value = true;
  stoppingTasks.value = false;
}

function onScroll(
  details: UnwrapRef<{
    direction: string;
    position: { top: number };
    delta: { top: number };
  }>,
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
      state.lockBottomScroll = true;
      //console.log('lock bottom scroll!', lockBottomScroll.value);
    } else if (
      details.direction === 'up' &&
      scrollEnd - details.position.top > bottomTolerance + 20
    ) {
      //console.log('release bottom lock!');
      state.lockBottomScroll = false;
    }
  }
}

function onResize() {
  if (state.lockBottomScroll) {
    //console.log('scroll to bottom');
    scrollToThreadEnd();
  }
}

function scrollToThreadEnd() {
  const offset = document.body.scrollHeight - window.innerHeight;
  const duration = 300;
  state.lockBottomScroll = true;
  setVerticalScrollPosition(window, offset, duration);
}

async function updateTaskThread(taskId: string | undefined) {
  console.log('update task thread...');
  if (taskId) {
    const threadIDChain = await (
      await state.getTaskManager()
    ).taskChain(taskId);
    const TM = await state.getTaskManager();
    const thread = (await Promise.all(
      threadIDChain.map(async (tId) => {
        return await TM.getTask(tId);
      }),
    )) as TaskNode[];
    selectedThread.value = thread;
  } else {
    selectedThread.value = [];
  }
}

void updateTaskThread(state.llmSettings.selectedTaskId);
watch(() => state.llmSettings.selectedTaskId, updateTaskThread);

function handleResize(size: { height: number }) {
  bottomPadding.value = size.height;
}
</script>
