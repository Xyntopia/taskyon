<template>
  <!--Task Page-->
  <FadeAwayScrollPage class="column chat-page" :style-fn="myPageStyle">
    <!--Chat Area-->
    <div v-if="state.taskyonRunmode === 'waiting for connection'">Connecting....</div>
    <div id="chat-area" ref="taskThreadContainer">
      <!--<q-resize-observer :debounce="500" @resize="onResize" />-->
      <q-scroll-observer
        axis="vertical"
        :debounce="0"
        :scroll-target="taskThreadContainer"
        @scroll="scm.onScroll"
      />
      <!--
      // TODO: I don't think we need this right now...
      <q-resize-observer
        :debounce="50"
        :scroll-target="taskThreadContainer"
        @resize="scm.autoScroll"
      />
      -->

      <!-- "Task" Display (.tasks-container & .task-container) -->
      <TaskChainViewer
        v-if="tystate.selectedThread.value.length > 0 && tystate.currentTask.value"
        :selected-thread="tystate.selectedThread.value"
        :current-task="tystate.currentTask.value"
        :show-all-tasks="showAllTasks"
        :show-hierarchy="showHierarchy"
        :task-tree-root="rootTaskId"
        :show-ids="showAllTasks"
        :expert-mode="state.appConfiguration.expertMode"
        @on-size-change="scm.autoScroll"
      />
      <div v-else-if="loadingChat" class="text-secondary text-h6 q-pa-xl column items-center">
        loading chat
        <q-spinner-comment color="q-ma-md" size="2em" />
      </div>
      <!-- Welcome Message -->
      <div
        v-else
        class="column justify-center items-center q-pa-lg welcome"
        style="max-width: 650px"
      >
        <div class="welcome-message column items-center">
          <GetStarted />
        </div>
        <CreateNewTask
          :file-attachments="fileAttachments"
          :entry-node="tystate.entryNode"
          class="q-pa-md col self-stretch"
          :min-mode="state.minimalGui === 'iframe'"
          :expert-mode="state.appConfiguration.expertMode"
          add-to-taskyon
        />
      </div>
      <component :is="ResetButton" v-if="ResetButton" color="secondary" flat mode="all" />
    </div>
    <!--Task Chat Control Buttons-->
    <div style="height: 0px" class="relative-position">
      <TaskControlButtons
        class="absolute-bottom-right q-pa-xs"
        :show-bottom-scroll-lock="!state.lockBottomScroll"
        @scroll-to-thread-end="scm.scrollToBottom"
      />
    </div>
    <!--Create new task area-->
    <div class="col-auto row justify-center create-new-task-container self-stretch">
      <CreateNewTask
        v-if="tystate.selectedThread.value.length > 0"
        :file-attachments="fileAttachments"
        :entry-node="tystate.entryNode"
        class="col q-pa-xs create-new-task"
        :min-mode="state.minimalGui === 'iframe'"
        :expert-mode="state.appConfiguration.expertMode"
        style="max-width: 48rem"
        add-to-taskyon
      />
    </div>
    <!--STICK ELEMENTS AREA...-->

    <!--File Drop Zone Overlay-->
    <FileDropzone
      class="chat-drop-zone"
      no-buttons
      drop-zone-target=".q-page.chat-page"
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
        class="column q-gutter-md q-mt-lg items-center text-secondary announcements rounded-borders"
        style="max-width: 600px"
      >
        <transition-group
          appear
          :duration="3000"
          enter-active-class="animated fadeIn"
          leave-active-class="animated slow fadeOut"
        >
          <!--Need to install a chat service-->
          <div v-if="tystate.noAiService === true" class="col text-secondary bg-primary">
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
import { mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import CreateNewTask from 'components/taskyon/CreateNewTask.vue'
import GetStarted from 'components/taskyon/GetStarted.vue'
import TaskChainViewer from 'components/taskyon/TaskChainViewer.vue'
import { useMeta, useQuasar } from 'quasar'
import FadeAwayScrollPage from 'src/components/FadeAwayScrollPage.vue'
import FileDropzone from 'src/components/FileDropzone.vue'
import PasswordRequestDialog from 'src/components/PasswordRequestDialog.vue'
import ToggleButton from 'src/components/ToggleButton.vue'
import { fetchMarkdown, getTextFile } from 'src/modules/taskyon/taskUtils'
import { sleep } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TaskControlButtons from '../../components/taskyon/TaskControlButtons.vue'
import { createScrollManager } from 'src/modules/vueUtils'
import { storeToRefs } from 'pinia'

// we are re-creating the following meta tag dynamically here just for the chat page!
// <!-- Viewport Meta in order to make window size shrink on mobile when keyboard pops up! -->
// <meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content">
useMeta(() => ({
  // set the viewport meta dynamically
  meta: {
    viewport: {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1.0, interactive-widget=resizes-content',
    },
  },
}))

const props = defineProps<{ detailed?: boolean; treeBrowser?: boolean; rootTaskId?: string }>()
const showAllTasks = ref<boolean>(props.detailed)
const showHierarchy = ref(false)
const loadingChat = ref(false)

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

const $q = useQuasar()
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
onMounted(async () => {
  const ty = await tystate.taskyon
  void ty.onAskNewSecret(({ args: [{ id, secretName, message }], respond }) => {
    console.log('new secret request window', id, secretName)
    showPassWordDialog.value = true
    infoText.value =
      message ?? `Please enter the secret '${secretName}' for '${String(id).split(':')[0]}'`
    resolveSecret = respond
  })
})

const openPopupMessage = (message: string) => {
  popupMessage.value = message
  showPopupMessage.value = true
}

async function updateChatThread() {
  console.log('update chat thread')
  const ty = await tystate.taskyon
  if (typeof route.query.gd === 'string') {
    state.lockBottomScroll = false
    const gdFileId = route.query.gd
    const markdownUrl = `https://share.taskyon.space/proxy/gdrive/${gdFileId}`
    loadingFromGdrive.value = true
    invitedChat.value = true
    try {
      const markdownContent = await getTextFile(markdownUrl)
      const newTaskId = await ty.addMdTaskChain(markdownContent)
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
      const newTaskId = await ty.addMdTaskChain(markdownContent)
      state.setSelectedTask(newTaskId)
    }
  } else if (route.params.filePath) {
    state.lockBottomScroll = false
    const urlPath = (route.params.filePath as string[]).join('/')
    const filePath = urlPath.endsWith('.md') ? urlPath : `${urlPath}.md`
    let newTaskId: string | undefined
    try {
      const markdownContent = filePath ? await fetchMarkdown(folder || '', filePath) : undefined
      newTaskId = await ty.addMdTaskChain(markdownContent)
    } catch {
      newTaskId = (
        await ty.addPartialTask2Tree({
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
        })
      ).id
    }

    state.setSelectedTask(newTaskId)
  } else if (typeof route.query.t === 'string') {
    state.setSelectedTask(route.query.t)
  }
}

const { lockBottomScroll } = storeToRefs(state)
const scm = createScrollManager(taskThreadContainer, lockBottomScroll)

watch(tystate.currentTask, () => {
  scm.autoScroll()
  loadingChat.value = false
})

// Watch selectedTaskId and update URL query parameter
watch(
  () => state.llmSettings.selectedTaskId,
  (newTaskId) => {
    console.log('set new task', newTaskId)
    if (!route.params.filePath && !route.query.gd) {
      // we are using window.history here and NOT vue router
      // itself, because we dn't want to trigger any updates!
      if (newTaskId) {
        const url = new URL(window.location.href)
        url.searchParams.set('t', newTaskId)
        window.history.replaceState({}, '', url.toString())
      } else {
        const url = new URL(window.location.href)
        url.searchParams.delete('t')
        window.history.replaceState({}, '', url.toString())
      }
    }
  },
  { immediate: true },
)

watch(
  () => route.query,
  async () => {
    // don't update chat if the task is the same as we ahve alread selected...
    if (route.query.t && route.query.t === state.llmSettings.selectedTaskId) return
    loadingChat.value = true
    await updateChatThread()
    if (tystate.currentTask) loadingChat.value = false
  },
  { immediate: true },
)

// we make sure, that we use "dvh" and also we need to declare
// q-page to be a
function myPageStyle(offset: number) {
  // offset = header+footer size in px
  return {
    display: 'flex',
    flexDirection: 'column',
    height: offset ? `calc(100dvh - ${offset}px)` : '100dvh',
  }
}

// disable/enable  page reload when scrolling "too far down"
onMounted(() => {
  document.documentElement.classList.add('no-ptr')
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('no-ptr')
})
</script>

<style lang="sass">
#chat-area
  flex: 1
  overflow-y: auto
  display: flex
  flex-direction: column
  align-items: center

  .tasks-container
    width: min(100%, 800px)
    max-width: 800px
    min-width: 0
    min-height: 0
    padding: 15px 2px

    .task-container
      margin-bottom: 15px
      padding-left: 5px
      padding-right: 5px
      border-radius: 5px
      display: flex
      flex-direction: column
      min-width: 0
      min-height: 0

      //width: calc(100% - 20px)

      // Only if there is an <iframe> child:
      /* Cap width to (100% of parent – 20px margin).
        This ensures the iframe can grow up to the container’s full width minus the margin. */
      &:has(.markdown-iframe)
        width: calc(100% - 20px)

      &.user
        position: relative // anchor for ::before
        align-self: flex-end
        margin-left: 20px // reserve space for glow
        padding-left: 10px

        &::before
          content: ""
          position: absolute
          left: -10px // move into the margin area
          top: 2px
          bottom: 2px
          width: 3px
          border-radius: 2px
          //background: rgb($primary)
          //box-shadow: 0 0 3px 3px rgba($primary, 0.6)

      &:not(.user)
        align-self: flex-start
        margin-right: 20px
</style>
