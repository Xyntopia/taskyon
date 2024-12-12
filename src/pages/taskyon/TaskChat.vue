<template>
  <!--Task Page-->
  <q-page class="column">
    <q-resize-observer :debounce="50" @resize="onResize" />
    <!--Chat Area-->
    <div
      ref="taskThreadContainer"
      class="col column items-center"
      :style="`padding-bottom: ${bottomPadding + 5}px;`"
    >
      <q-scroll-observer axis="vertical" :debounce="500" @scroll="onScroll" />
      <div
        class="row items-center q-pa-sm"
        style="max-width: 600px"
        v-if="tystate.selectedThread.length > 0 && showIntroduction"
      >
        <q-icon
          class="col-auto q-pa-xl"
          size="2rem"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          :color="$q.dark.isActive ? 'secondary' : 'primary'"
        ></q-icon>
        <div class="col text-subtitle2 text-center">
          You've been invited to read this chat! Scroll down and start reading
          or click the button below to get started with Taskyon.
        </div>
      </div>
      <!-- "Task" Display -->
      <ConversationWidget
        v-if="tystate.selectedThread.length > 0"
        :selected-thread="tystate.selectedThread"
        :current-task="tystate.currentTask"
        :task-worker-waiting="tystate.taskWorkerWaiting"
        :task-worker-message="taskWorkerMessage || ''"
      />
      <!-- Welcome Message -->
      <div
        v-if="tystate.selectedThread.length == 0 || showIntroduction"
        class="col column justify-center items-center q-pa-sm welcome"
        style="max-width: 600px"
      >
        <q-icon
          class="q-pa-xl"
          size="10rem"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          :color="$q.dark.isActive ? 'secondary' : 'primary'"
        ></q-icon>
        <component
          :is="ResetButton"
          v-if="ResetButton"
          color="secondary"
          flat
          mode="all"
        ></component>
        <div class="welcome-message column items-center">
          <LLMProviders
            v-if="showIntroduction"
            :expert-mode-on="state.appConfiguration.expertMode"
          />
          <GetStarted v-else />
        </div>
      </div>
    </div>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand class="print-hide">
      <q-resize-observer @resize="handleResize" />
      <div class="col" style="max-width: 48rem">
        <CreateNewTask
          v-if="!showIntroduction"
          :force-task-props="state.llmSettings.taskTemplate"
          class="q-pa-xs"
          :hide-task-info="state.minimalGui"
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
      <TaskControlButtons @scroll-to-thread-end="scrollToThreadEnd" />
    </q-page-sticky>
  </q-page>
</template>

<script setup lang="ts">
import { ref, type UnwrapRef, computed, watch } from 'vue';
import { useQuasar, scroll } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import CreateNewTask from 'components/taskyon/CreateNewTask.vue';
import GetStarted from 'components/taskyon/GetStarted.vue';
import ConversationWidget from 'components/taskyon/ConversationWidget.vue';
import { defineAsyncComponent } from 'vue';
import { fetchMarkdown, getTextFile } from 'src/modules/taskyon/taskUtils';
import TaskControlButtons from '../../components/taskyon/TaskControlButtons.vue';
import { useRouter, useRoute } from 'vue-router';
import { useAppStateStore } from 'src/stores/appState';
import LLMProviders from 'components/taskyon/LLMProviders.vue';

const ResetButton = process.env.DEV
  ? defineAsyncComponent(
      () =>
        import(
          /* webpackPrefetch: true */
          /* webpackChunkName: "codemirror" */
          /* webpackMode: "lazy" */
          /* webpackFetchPriority: "low" */
          'src/components/taskyon/TyResetButton.vue'
        ),
    )
  : undefined;

const { getScrollHeight, getScrollTarget, setVerticalScrollPosition } = scroll;
const bottomPadding = ref(100);
const $q = useQuasar();
const router = useRouter();
const route = useRoute();
const tystate = useTaskyonStore();
const state = useAppStateStore();
const taskThreadContainer = ref<HTMLElement | undefined>();
$q.dark.set(state.darkTheme); // TODO: this needs to go into our taskyon store...
const folder = '';

const showIntroduction = computed(
  () =>
    !(
      state.llmSettings.selectedApi && state.keys[state.llmSettings.selectedApi]
    ),
);

async function updateChatThread() {
  console.log('update chat thread');
  if (typeof route.query.gd === 'string') {
    const gdFileId = route.query.gd;
    const markdownUrl = `https://share.taskyon.space/proxy/gdrive/${gdFileId}`;
    const markdownContent = await getTextFile(markdownUrl);
    const newTaskId = await tystate.addMdTasks(markdownContent);

    state.llmSettings.selectedTaskId = newTaskId;
    state.lockBottomScroll = true;
  } else if (typeof route.query.url === 'string') {
    const markdownUrl = route.query.url ? new URL(route.query.url) : undefined;
    if (markdownUrl) {
      const markdownContent = await getTextFile(markdownUrl);
      const newTaskId = await tystate.addMdTasks(markdownContent);
      state.llmSettings.selectedTaskId = newTaskId;
      state.lockBottomScroll = true;
    }
  } else if (route.params.filePath) {
    const urlPath = (route.params.filePath as string[]).join('/');
    const filePath = urlPath.endsWith('.md') ? urlPath : `${urlPath}.md`;
    const markdownContent = filePath
      ? await fetchMarkdown(folder || '', filePath)
      : undefined;
    const newTaskId = await tystate.addMdTasks(markdownContent);

    state.llmSettings.selectedTaskId = newTaskId;
    state.lockBottomScroll = true;
  } else if (typeof route.query.t === 'string') {
    state.llmSettings.selectedTaskId = route.query.t;
    state.lockBottomScroll = true;
  }
}

const taskWorkerMessage = computed(() => {
  return tystate.taskWorkerWaiting
    ? tystate.taskWorkerController.getInterruptReason()
    : '';
});

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

function handleResize(size: { height: number }) {
  bottomPadding.value = size.height;
}

// Watch selectedTaskId and update URL query parameter
watch(
  () => state.llmSettings.selectedTaskId,
  (newTaskId) => {
    console.log('set new task', newTaskId);
    if (!route.params.filePath && !route.query.gd) {
      // we are only doing this if there is no filepath, because filepaths have priority ;)
      router.push({
        query: { ...route.query, t: newTaskId || undefined },
      });
    }
  },
  { immediate: true },
);

watch(
  () => route.query,
  () => {
    updateChatThread();
  },
  { immediate: true },
);
</script>
