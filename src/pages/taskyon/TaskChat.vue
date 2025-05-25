<template>
  <!--Task Page-->
  <q-page class="column">
    <q-resize-observer :debounce="50" @resize="onResize" />
    <!--Chat Area-->
    <div
      id="chat-area"
      ref="taskThreadContainer"
      class="col column items-center"
      :style="`padding-bottom: ${bottomPadding + 5}px;`"
    >
      <q-scroll-observer axis="vertical" :debounce="500" @scroll="onScroll" />
      <div
        v-if="tystate.selectedThread.value.length > 0 && showIntroduction"
        class="row items-center q-pa-sm"
        style="max-width: 600px"
      >
        <q-icon
          class="col-auto q-pa-xl"
          size="2rem"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          :color="$q.dark.isActive ? 'fsecondary' : 'primary'"
        ></q-icon>
        <div class="col text-subtitle2 text-center">
          You've been invited to read this chat! Scroll down and start reading
          <q-btn label="Or start using Taskyon" dense no-caps outline @click="scrollToThreadEnd" />
        </div>
      </div>
      <!-- "Task" Display -->
      <ConversationWidget
        v-if="tystate.selectedThread.value.length > 0"
        :selected-thread="tystate.selectedThread.value"
        :current-task="tystate.currentTask.value"
        :show-all-tasks="showAllTasks"
        :show-hierarchy="showHierarchy"
        :task-tree-root="rootTaskId"
        :show-ids="showAllTasks"
        :expert-mode="state.appConfiguration.expertMode"
      />
      <!-- Welcome Message -->
      <div
        v-if="tystate.selectedThread.value.length == 0 || showIntroduction"
        class="col column justify-center items-center q-pa-sm welcome"
        style="max-width: 600px"
      >
        <!-- <q-icon
          class="q-pa-xl"
          size="10rem"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          :color="$q.dark.isActive ? 'secondary' : 'primary'"
        ></q-icon> -->
        <svg
          version="1.1"
          id="Layer_1"
          xmlns="http://www.w3.org/2000/svg"
          xmlns:xlink="http://www.w3.org/1999/xlink"
          viewBox="0 0 301 315"
          style="width: 10rem; height: 10rem"
        >
          <!-- Main structure (white paths) -->
          <path
            class="logo-path white-path path-1 reverse"
            d="M189.6,109.6l-30.2,30.2c-0.9,0.9-1.5,2.2-1.5,3.5v116.6c0,1.3,0.5,2.6,1.5,3.5l27.9,27.9"
          />
          <path
            class="logo-path white-path path-2 reverse"
            d="M112.9,89.6l31.2,31.2c0.9,0.9,1.5,2.2,1.5,3.5v135.9c0,1.3-0.5,2.6-1.5,3.5l-27.8,27.8"
          />

          <path
            class="logo-path orange-path path-3 reverse"
            d="M168.2,192.3l21.8-21.8c0.9-0.9,2.2-1.5,3.5-1.5h37.3"
          />
          <path
            class="logo-path orange-path path-4"
            d="M192.9,157.5h35.7c1.3,0,2.6-0.5,3.5-1.5l20.6-20.6c0.9-0.9,2.2-1.5,3.5-1.5h21.7"
          />
          <path class="logo-path orange-path path-5" d="M226.3,145.7l38.1-38.1" />
          <path class="logo-path orange-path path-6" d="M168.1,145.7l74.3-74.3" />
          <path
            class="logo-path orange-path path-7"
            d="M197.6,179.3h21.5c1.3,0,2.6,0.5,3.5,1.5l22.8,22.8"
          />
          <path
            class="logo-path orange-path path-8"
            d="M135,179.9l-22.9-22.9c-0.9-0.9-2.2-1.5-3.5-1.5H72.7"
          />
          <path
            class="logo-path orange-path path-9"
            d="M106.3,165.7H64.1c-1.3,0-2.6,0.5-3.5,1.5l-23.2,23.2"
          />
          <path
            class="logo-path orange-path path-10"
            d="M135.6,163.6L87,114.9c-0.9-0.9-2.2-1.5-3.5-1.5H32.7"
          />
          <path class="logo-path orange-path path-11" d="M129.3,120.4L68.7,59.8" />
          <path
            class="logo-path orange-path path-12"
            d="M156.3,126.7l15.9-15.9c0.9-0.9,1.5-2.2,1.5-3.5V31.1"
          />
          <path class="logo-path orange-path path-13" d="M135.6,29.1v54" />
          <path
            class="logo-path orange-path path-14 reverse"
            d="M110.7,35.6l14,14c0.9,0.9,1.5,2.2,1.5,3.5v32.6c0,1.3,0.5,2.6,1.5,3.5l22.5,22.5"
          />

          <!-- Bottom white paths -->
          <path
            class="logo-path white-path path-15 reverse"
            d="M168.1,255.1l12.8,12.8c0.9,0.9,2.2,1.5,3.5,1.5h24.8"
          />
          <path
            class="logo-path white-path path-16"
            d="M95.4,269.3h25.3c1.3,0,2.6-0.5,3.5-1.5l12.6-12.6"
          />
        </svg>
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
    <!--File Drop Zone Overlay-->
    <FileDropzone
      class="chat-drop-zone"
      disable-dropzone-border
      no-buttons
      drop-zone-target="#chat-area"
      accept="*"
      @add-files="
        (newFiles) => {
          console.log('adding files!!', newFiles)
          fileAttachments.push(...newFiles)
        }
      "
    />
    <!--Task Browser buttons-->
    <q-page-sticky position="top-left" class="print-hide">
      <div v-if="detailed" class="q-pa-sm q-gutter-sm toolbar">
        <ToggleButton v-model="showAllTasks" dense flat label="dev">
          <q-tooltip>Show Detailed Task Chain</q-tooltip>
        </ToggleButton>
        <ToggleButton v-model="showHierarchy" :icon="mdiSubdirectoryArrowRight" dense flat>
          <q-tooltip>Show Hierachy</q-tooltip>
        </ToggleButton>
      </div>
    </q-page-sticky>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand class="print-hide">
      <q-resize-observer @resize="handleResize" />
      <div class="col create-new-task-container" style="max-width: 48rem">
        <CreateNewTask
          v-if="!showIntroduction"
          :file-attachments="fileAttachments"
          :force-task-props="state.llmSettings.taskTemplate"
          class="q-pa-xs"
          :hide-task-info="state.minimalGui"
          :expert-mode="state.appConfiguration.expertMode"
          :expanded-task-creation="state.expandedTaskCreation"
        >
        </CreateNewTask>
      </div>
    </q-page-sticky>
    <!--Task Chat Control Buttons-->
    <q-page-sticky position="bottom-right" :offset="[10, bottomPadding + 5]" class="print-hide">
      <TaskControlButtons @scroll-to-thread-end="scrollToThreadEnd" />
    </q-page-sticky>
  </q-page>
</template>

<script setup lang="ts">
import { ref, type UnwrapRef, computed, watch } from 'vue'
import { useQuasar, scroll } from 'quasar'
import { useTaskyonStore } from 'stores/taskyonState'
import CreateNewTask from 'components/taskyon/CreateNewTask.vue'
import GetStarted from 'components/taskyon/GetStarted.vue'
import ConversationWidget from 'components/taskyon/ConversationWidget.vue'
import { defineAsyncComponent } from 'vue'
import { fetchMarkdown, getTextFile } from 'src/modules/taskyon/taskUtils'
import TaskControlButtons from '../../components/taskyon/TaskControlButtons.vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStateStore } from 'src/stores/appState'
import LLMProviders from 'components/taskyon/LLMProviders.vue'
import ToggleButton from 'src/components/ToggleButton.vue'
import { mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import FileDropzone from 'src/components/FileDropzone.vue'

const props = defineProps<{ detailed?: boolean; treeBrowser?: boolean; rootTaskId?: string }>()
const showAllTasks = ref<boolean>(props.detailed)
const showHierarchy = ref<boolean>(false)

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
  : undefined

const { getScrollHeight, getScrollTarget, setVerticalScrollPosition } = scroll
const bottomPadding = ref(100)
const $q = useQuasar()
const router = useRouter()
const route = useRoute()
const tystate = useTaskyonStore()
const state = useAppStateStore()
const taskThreadContainer = ref<HTMLElement | undefined>()
const folder = ''
const fileAttachments = ref<File[]>([]) // holds all attached files as a "tasklist"

const showIntroduction = computed(
  () => !(state.llmSettings.selectedApi && state.keys[state.llmSettings.selectedApi]),
)

async function updateChatThread() {
  console.log('update chat thread')
  const tm = await tystate.getTaskManager()
  if (typeof route.query.gd === 'string') {
    state.lockBottomScroll = false
    const gdFileId = route.query.gd
    const markdownUrl = `https://share.taskyon.space/proxy/gdrive/${gdFileId}`
    const markdownContent = await getTextFile(markdownUrl)
    const newTaskId = await tm.addMdTaskChain(markdownContent)
    state.setSelectedTask(newTaskId)
  } else if (typeof route.query.url === 'string') {
    const markdownUrl = route.query.url ? new URL(route.query.url) : undefined
    if (markdownUrl) {
      state.lockBottomScroll = false
      const markdownContent = await getTextFile(markdownUrl)
      const newTaskId = await tm.addMdTaskChain(markdownContent)
      state.setSelectedTask(newTaskId)
    }
  } else if (route.params.filePath) {
    state.lockBottomScroll = false
    const urlPath = (route.params.filePath as string[]).join('/')
    const filePath = urlPath.endsWith('.md') ? urlPath : `${urlPath}.md`
    let newTaskId: string | undefined
    try {
      const markdownContent = filePath ? await fetchMarkdown(folder || '', filePath) : undefined
      newTaskId = await tm.addMdTaskChain(markdownContent)
    } catch {
      newTaskId = (
        await tm.addPartialTask2Tree(
          {
            content: {
              type: 'message',
              data: `# 404 - Markdown Not Found

The markdown file \`${filePath}\` does not exist.

## What might have happened?

- The file path might be incorrect
- The file might have been moved or deleted
- You might not have permission to access this file

Please check the path and try again.
`,
            },
            role: 'system',
          },
          undefined,
          undefined,
        )
      ).id
    }

    state.setSelectedTask(newTaskId)
  } else if (typeof route.query.t === 'string') {
    state.setSelectedTask(route.query.t)
    state.lockBottomScroll = true
  }
}

function onScroll(
  details: UnwrapRef<{
    direction: string
    position: { top: number }
    delta: { top: number }
  }>,
) {
  //  const currentPosition = getVerticalScrollPosition(scrollTargetDomElement); // returns a Number (pixels);
  //const taskThreadArea = document.getElementsByClassName('taskThreadArea')[0];
  if (taskThreadContainer.value) {
    //const el = document.querySelector(id)
    //const el = document.getElementsByClassName()
    const scrollTargetElement = getScrollTarget(taskThreadContainer.value)
    const target = getScrollHeight(scrollTargetElement)
    const scrollEnd = target - (scrollTargetElement as Window).innerHeight
    //const scrollHeight = getScrollHeight(scrollTargetDomElement); // returns a Number
    //const currentPos = getVerticalScrollPosition(scrollTargetElement);
    const bottomTolerance = 10
    if (details.direction === 'down' && scrollEnd - details.position.top < bottomTolerance) {
      state.lockBottomScroll = true
      //console.log('lock bottom scroll!', lockBottomScroll.value);
    } else if (
      details.direction === 'up' &&
      scrollEnd - details.position.top > bottomTolerance + 20
    ) {
      //console.log('release bottom lock!');
      state.lockBottomScroll = false
    }
  }
}

function onResize() {
  if (state.lockBottomScroll) {
    //console.log('scroll to bottom');
    scrollToThreadEnd()
  }
}

function scrollToThreadEnd() {
  const offset = document.body.scrollHeight - window.innerHeight
  const duration = 300
  state.lockBottomScroll = true
  //console.log('scroll to end of chat!');
  setVerticalScrollPosition(window, offset, duration)
}

function handleResize(size: { height: number }) {
  bottomPadding.value = size.height
}

// Watch selectedTaskId and update URL query parameter
watch(
  () => state.llmSettings.selectedTaskId,
  (newTaskId) => {
    console.log('set new task', newTaskId)
    if (!route.params.filePath && !route.query.gd) {
      // we are only doing this if there is no filepath, because filepaths have priority ;)
      void router.push({
        query: { ...route.query, t: newTaskId || undefined },
      })
    }
  },
  { immediate: true },
)

watch(
  () => route.query,
  () => {
    void updateChatThread()
  },
  { immediate: true },
)
</script>
<style scoped>
.logo-path {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
  stroke-miterlimit: 10;
  stroke-dasharray: 1000;
  animation: drawLine 1.5s ease forwards;
}

.white-path {
  stroke: #fff;
}

.orange-path {
  stroke: var(--q-secondary);
}

.reverse {
  stroke-dashoffset: -1000;
}

@keyframes drawLine {
  to {
    stroke-dashoffset: 0;
  }
}

.path-1,
.path-2,
.path-3,
.path-4,
.path-5,
.path-6,
.path-7,
.path-8,
.path-9,
.path-10,
.path-11,
.path-12,
.path-13,
.path-14,
.path-15,
.path-16 {
  stroke-dashoffset: -1000;
}
</style>
