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
      <!-- "Task" Display -->
      <ConversationWidget
        v-if="
          state.selectedThread.length > 0 &&
          state.llmSettings.selectedApi &&
          state.keys[state.llmSettings.selectedApi]
        "
        :selected-thread="state.selectedThread"
        :state="state"
        :current-task="state.currentTask"
        :task-worker-waiting="state.taskWorkerWaiting"
        :task-worker-message="taskWorkerMessage || ''"
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
        <component :is="ResetButton" v-if="ResetButton"></component>
        <GetStarted />
      </div>
    </div>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand class="print-hide">
      <q-resize-observer @resize="handleResize" />
      <div class="col" style="max-width: 48rem">
        <CreateNewTask
          v-if="
            state.llmSettings.selectedApi &&
            state.keys[state.llmSettings.selectedApi]
          "
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
import { ref, onMounted, UnwrapRef, computed, watch } from 'vue';
import { useQuasar, scroll } from 'quasar';
import { useRouter, useRoute } from 'vue-router';
import { useTaskyonStore } from 'stores/taskyonState';
import CreateNewTask from 'components/taskyon/CreateNewTask.vue';
import GetStarted from 'components/taskyon/GetStarted.vue';
import ConversationWidget from 'components/taskyon/ConversationWidget.vue';
import { defineAsyncComponent } from 'vue';
import { fetchMarkdown } from 'src/modules/taskyon/taskUtils';
import TaskControlButtons from '../../components/taskyon/TaskControlButtons.vue';

const props = defineProps<{
  query?: {
    t?: string;
    url?: string;
  };
  folder?: string;
  filePath?: string;
}>();

let ResetButton = process.env.DEV
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
const state = useTaskyonStore();
const taskThreadContainer = ref<HTMLElement | undefined>();
$q.dark.set(state.darkTheme); // TODO: this needs to go into our taskyon store...

const taskWorkerMessage = computed(() => {
  return state.taskWorkerWaiting
    ? state.taskWorkerController.getInterruptReason()
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

async function onAddTasks(url?: string, filePath?: string, folder?: string) {
  const markdownUrl = url ? new URL(url) : undefined;
  const markdownContent = filePath
    ? await fetchMarkdown(folder || '', filePath)
    : undefined;
  const parentId = await state.addMdTasks(
    markdownContent,
    undefined,
    markdownUrl,
  );

  state.llmSettings.selectedTaskId = parentId;
  state.lockBottomScroll = true;
}

// Fetch markdown based on props
onMounted(async () => {
  if (props.query?.url || props.filePath) {
    onAddTasks(props.query?.url, props.filePath, props.folder);
  }
});

// Set initial selectedTaskId based on query
onMounted(() => {
  if (props.query?.t) {
    state.llmSettings.selectedTaskId = props.query.t;
  }
  /* else {
    state.llmSettings.selectedTaskId = undefined;
  }*/
});

// Watch selectedTaskId and update URL query parameter
watch(
  () => state.llmSettings.selectedTaskId,
  (newTaskId) => {
    console.log('set new task', newTaskId);
    router.push({
      query: { ...route.query, t: newTaskId || undefined },
    });
  },
);
</script>
