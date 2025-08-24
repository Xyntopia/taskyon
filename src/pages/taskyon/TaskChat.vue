<template>
  <!--Task Page-->
  <FadeAwayScrollPage class="column">
    <q-resize-observer :debounce="500" @resize="onResize" />
    <!--Chat Area-->
    <div
      id="chat-area"
      ref="taskThreadContainer"
      :style="`padding-bottom: ${bottomPadding + 5}px;`"
      class="col full-height column justify-center"
    >
      <q-scroll-observer axis="vertical" :debounce="1000" @scroll="onScroll" />
      <!-- "Task" Display -->
      <TaskChainViewer
        v-if="tystate.selectedThread.value.length > 0 && tystate.currentTask.value"
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
        v-else
        class="column justify-center items-center q-pa-sm welcome"
        style="max-width: 600px"
      >
        <div class="welcome-message column items-center">
          <GetStarted />
        </div>
        <CreateNewTask
          :file-attachments="fileAttachments"
          :entry-node="tystate.entryNode"
          class="q-pa-md col self-stretch"
          :min-mode="state.minimalGui !== 'default'"
          :expert-mode="state.appConfiguration.expertMode"
        />
      </div>
      <component :is="ResetButton" v-if="ResetButton" color="secondary" flat mode="all" />
    </div>
    <!--File Drop Zone Overlay-->
    <FileDropzone
      class="chat-drop-zone"
      no-buttons
      drop-zone-target="#chat-area"
      accept="*"
      @add-files="
        (newFiles: File[]) => {
          console.log('adding files!!', newFiles)
          fileAttachments.push(...newFiles)
        }
      "
    />
    <!--Task Browser buttons-->
    <q-page-sticky position="top-left" class="task-browser-buttons">
      <div v-if="detailed" class="q-pa-sm q-gutter-sm toolbar">
        <ToggleButton v-model="showAllTasks" dense flat label="dev">
          <q-tooltip>Show Detailed Task Chain</q-tooltip>
        </ToggleButton>
        <ToggleButton v-model="showHierarchy" :icon="mdiSubdirectoryArrowRight" dense flat>
          <q-tooltip>Show Hierachy</q-tooltip>
        </ToggleButton>
      </div>
    </q-page-sticky>
    <!-- Announcements -->
    <q-page-sticky position="top" :offset="[0, 0]" expand style="z-index: 20">
      <div
        class="column q-gutter-md q-mt-lg items-center text-secondary announcements"
        style="max-width: 600px"
      >
        <transition-group
          appear
          :duration="3000"
          enter-active-class="animated fadeIn"
          leave-active-class="animated slow fadeOut"
        >
          <!--Need to install a chat service-->
          <div v-if="noAiService" class="col text-secondary bg-primary">
            <div class="row items-center q-pa-sm">
              <q-icon
                class="col-auto q-pr-md"
                size="2rem"
                name="svguse:/taskyon_mono_opt.svg#taskyon"
                :color="$q.dark.isActive ? 'primary' : 'secondary'"
              ></q-icon>
              <div class="col">
                You currently have not activated any AI service provider with a chat completion API.
                For full functionality you should do that here:
              </div>
            </div>
            <q-btn
              flat
              class="fit"
              label="AI Service Provider Settings"
              to="/settings/aiserviceprovider"
            />
          </div>
          <!--chat share welcome message-->
          <div
            v-if="tystate.selectedThread.value.length > 0 && invitedChat"
            class="col introduction-message bg-primary column"
          >
            <div class="row items-center q-pa-sm">
              <q-icon
                class="col-auto q-pr-md"
                size="2rem"
                name="svguse:/taskyon_mono_opt.svg#taskyon"
                :color="$q.dark.isActive ? 'primary' : 'secondary'"
              ></q-icon>
              <div class="col">You've been invited to read this chat!</div>
            </div>
            <q-btn
              class="text-center fit"
              square
              flat
              label="Ok"
              color="secondary"
              @click="invitedChat = false"
            />
          </div>
          <!--gdrive loader-->
          <div v-if="loadingFromGdrive" class="col q-pa-sm bg-primary">
            <q-spinner-box color="secondary" size="3rem" class="q-mr-md" />
            <span class="text-subtitle2 text-secondary">
              Loading your shared conversation. Thank you for your patience...
            </span>
          </div>
        </transition-group>
      </div>
    </q-page-sticky>
    <!--Create new task area-->
    <q-page-sticky position="bottom" :offset="[0, 0]" expand>
      <q-resize-observer @resize="handleResize" />
      <div class="col create-new-task-container" style="max-width: 48rem">
        <CreateNewTask
          v-if="tystate.selectedThread.value.length > 0"
          :file-attachments="fileAttachments"
          :entry-node="tystate.entryNode"
          class="q-pa-xs"
          :min-mode="state.minimalGui !== 'default'"
          :expert-mode="state.appConfiguration.expertMode"
        />
      </div>
    </q-page-sticky>
    <!--Task Chat Control Buttons-->
    <q-page-sticky position="bottom-right" :offset="[10, bottomPadding + 5]">
      <TaskControlButtons
        :show-bottom-scroll-lock="!state.lockBottomScroll"
        @scroll-to-thread-end="scrollToThreadEnd"
      />
    </q-page-sticky>
    <!-- Popup Messages -->
    <q-dialog v-model="showPopupMessage" persistent>
      <q-card class="q-pa-md">
        <q-card-section class="text-body1">{{ popupMessage }}</q-card-section>
        <q-btn flat label="Close" @click="showPopupMessage = false" />
      </q-card>
    </q-dialog>
    <!-- Ask for Passwords... -->
    <password-request-dialog
      v-model="showPassWordDialog"
      :info-text="infoText"
      @ok="resolveSecret"
    />
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import { ref, type UnwrapRef, computed, watch, onMounted } from 'vue'
import { useQuasar, scroll } from 'quasar'
import { useTaskyonStore } from 'stores/taskyonState'
import CreateNewTask from 'components/taskyon/CreateNewTask.vue'
import GetStarted from 'components/taskyon/GetStarted.vue'
import TaskChainViewer from 'components/taskyon/TaskChainViewer.vue'
import { defineAsyncComponent } from 'vue'
import { fetchMarkdown, getTextFile } from 'src/modules/taskyon/taskUtils'
import TaskControlButtons from '../../components/taskyon/TaskControlButtons.vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStateStore } from 'src/stores/appState'
import ToggleButton from 'src/components/ToggleButton.vue'
import { mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import FileDropzone from 'src/components/FileDropzone.vue'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import { sleep } from 'src/modules/utils'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'

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
const loadingFromGdrive = ref(false)
const invitedChat = ref(false)
const popupMessage = ref<string | undefined>(undefined)
const showPopupMessage = ref(false)

const showPassWordDialog = ref(false)
const infoText = ref('get password')
let resolveSecret: (secret: string) => void
onMounted(() => {
  void tystate.secretStore.onNewSecret(({ args: [{ id, secretName, message }], respond }) => {
    console.log('new secret request window', id, secretName)
    showPassWordDialog.value = true
    infoText.value =
      message ?? `Please enter the secret '${secretName}' for '${String(id).split(':')[0]}'`
    resolveSecret = respond
  })
})

const noAiService = computed(
  () => !(state.llmSettings.selectedApi && state.keys[state.llmSettings.selectedApi]),
)

const openPopupMessage = (message: string) => {
  popupMessage.value = message
  showPopupMessage.value = true
}

async function updateChatThread() {
  console.log('update chat thread')
  const tm = await tystate.getTaskManager()
  if (typeof route.query.gd === 'string') {
    state.lockBottomScroll = false
    const gdFileId = route.query.gd
    const markdownUrl = `https://share.taskyon.space/proxy/gdrive/${gdFileId}`
    loadingFromGdrive.value = true
    invitedChat.value = true
    try {
      const markdownContent = await getTextFile(markdownUrl)
      const newTaskId = await tm.addMdTaskChain(markdownContent)
      state.setSelectedTask(newTaskId)
    } catch (error) {
      console.error('Error loading from Google Drive:', error)
      openPopupMessage(
        `Error loading from Google Drive: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      await sleep(2000)
      loadingFromGdrive.value = false
    }
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
              type: 'error',
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
