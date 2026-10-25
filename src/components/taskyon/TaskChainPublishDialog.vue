<template>
  <template v-if="buttons">
    <CopyTaskChatButton
      class="gt-xs"
      v-bind="$attrs"
      :tasks="copyableTaskList"
      :client="single ? undefined : tystate.taskyonClient"
      :selected-task-id="taskId"
      :tools="tystate.allTools"
    >
      <slot name="tt-cp-btn">
        <q-tooltip>Copy entire chat as markdown</q-tooltip>
      </slot>
    </CopyTaskChatButton>
    <q-btn v-bind="$attrs" :icon="matShare" aria-label="share content" @click="showDialog = true">
      <slot name="tt-share-btn">
        <q-tooltip>Share Content</q-tooltip>
      </slot>
    </q-btn>
  </template>
  <q-dialog v-model="showDialog">
    <q-card>
      <q-card-section>
        <div class="text-h5 row items-center justify-center no-wrap">
          <q-icon class="q-pr-md" :name="matShare" />
          <div>Choose sharing method</div>
        </div>

        <!-- Task Change Notification Banner -->
        <q-banner v-if="hasTaskChanged && sharedSourceUrl" class="q-mt-md" dense rounded>
          <template #avatar>
            <q-icon :name="matWarning" color="secondary" />
          </template>
          <template #action>
            <q-btn
              flat
              dense
              label="Regenerate"
              color="orange"
              :loading="loadingGdrive"
              @click="regenerateGdriveLink"
            />
            <q-btn flat dense :icon="matClose" color="orange" @click="dismissTaskChangeWarning" />
          </template>
          <div class="text-body2">
            The task has changed since the last link was generated.
            <strong>Consider regenerating</strong> to share the latest version.
          </div>
        </q-banner>

        <div class="column q-gutter-sm q-pt-md">
          <template v-if="share">
            <q-btn
              outline
              :icon="symOutlinedDriveExport"
              label="Save chat to Google Drive"
              :loading="loadingGdrive"
              @click="onExportPublicGdrive(selectedTaskList)"
            />
            <q-input
              v-model="providedSourceUrl"
              outlined
              dense
              type="url"
              label="Or use an existing public Markdown URL"
              hint="Provide a raw HTTPS Markdown document, not a provider preview page."
              data-cy="shared-chat-public-url"
            >
              <template #append>
                <q-btn flat dense :icon="matLink" label="Use URL" @click="usePublicUrl" />
              </template>
            </q-input>
            <q-slide-transition v-if="sharedSourceUrl">
              <div v-show="sharedSourceUrl" class="row q-gutter-md items-center justify-center">
                <q-btn
                  v-if="canShare"
                  class="q-mb-md"
                  outline
                  :icon="matShare"
                  label="Share via Social Apps"
                  @click="shareViaSocialApps"
                />
                <div class="column items-center">
                  <QrCode
                    :data="taskyonShareLink"
                    display-text="Scan this QR code to start a conversation with our AI assistant on Taskyon. This is a secure link to our official chat platform - simply scan and begin chatting!"
                    logo-fallback-text="TY"
                    show-fullscreen
                    show-logo
                    show-print
                    logo-url="/taskyon_mono_opt.svg"
                  />
                </div>
                <div>
                  <template
                    v-for="[link, label] in [
                      [taskyonShareLink, 'Copy Taskyon share link'],
                      [sharedSourceUrl, 'Copy source URL'],
                    ] as Array<[string, string]>"
                    :key="link"
                  >
                    <div class="text-caption">OR {{ label }}</div>
                    <div class="row q-gutter-sm q-py-sm items-center">
                      <div class="col-auto ellipsis text-weight-medium" style="max-width: 15rem">
                        {{ link }}
                        <q-tooltip>{{ link }}</q-tooltip>
                      </div>
                      <div class="col-auto">
                        <q-btn
                          flat
                          dense
                          :icon="matContentCopy"
                          @click="copyToClipboard(link || '')"
                        />
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </q-slide-transition>
          </template>
          <!--we only show this on small screens, because the copy button will disappear here-->
          <CopyTaskChatButton
            class="lt-sm"
            outline
            label="Copy to clipboard"
            :tasks="copyableTaskList"
            :client="single ? undefined : tystate.taskyonClient"
            :selected-task-id="taskId"
            :tools="tystate.allTools"
          />
          <template v-if="download">
            <q-btn
              outline
              :icon="symOutlinedMarkdown"
              label="Markdown"
              @click="onExportChatMD(selectedTaskList)"
            />
            <q-btn
              outline
              :icon="symOutlinedFileSave"
              label="YAML"
              @click="onExportChatYaml(selectedTaskList)"
            />
          </template>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Done" @click="showDialog = false"></q-btn>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import {
  matClose,
  matContentCopy,
  matLink,
  matShare,
  matWarning,
} from '@quasar/extras/material-icons'
import {
  symOutlinedDriveExport,
  symOutlinedFileSave,
  symOutlinedMarkdown,
} from '@quasar/extras/material-symbols-outlined'
import { validateSandboxFetchUrl } from '@taskyon/common/modules/webFetching/mediatedFetch'
import QrCode from '@taskyon/ui/components/QrCode.vue'
import CopyTaskChatButton from '@taskyon/ui/components/taskyon/CopyTaskChatButton.vue'
import { selectTasksForChatCopy } from '@taskyon/ui/components/taskyon/taskChatVisibility'
import { saveFile } from '@taskyon/ui/modules/fileSave'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { chat2Md, chatToYaml, type TaskNode } from '@taskyon/taskyon'
import { useQuasar } from 'quasar'
import { useGdrive } from 'src/modules/gdrive'
import { publicChatDownloadUrl } from 'src/modules/gdriveShareUrls'
import { asyncComputed } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, ref, watch } from 'vue'

const showDialog = defineModel({ type: Boolean, default: false })

const state = useAppStateStore()
const tystate = useTaskyonStore()
const canShare = navigator.canShare ? navigator.canShare() : false

// this here is done in order to check if taskyon is run locally...
// we want people to always be redirected to taskyon.space when using the sharing
// feature except if taskyon is run in development mode.
const baseURL = import.meta.env.QUASAR_DEV
  ? window.location.origin
  : window.location.origin.includes('dev.taskyon.space')
    ? 'https://dev.taskyon.space'
    : 'https://taskyon.space'

const {
  buttons = false,
  taskOrId,
  single = false,
  share = false,
  download = false,
} = defineProps<{
  taskOrId: string | TaskNode
  buttons?: boolean
  single?: boolean
  share?: boolean
  download?: boolean
}>()

const sharedSourceUrl = ref<string>()
const providedSourceUrl = ref('')
const loadingGdrive = ref(false)

// New state for tracking task changes
const lastGeneratedTaskId = ref<string>()
const hasTaskChangeWarningDismissed = ref(false)

const taskId = computed(() => (typeof taskOrId === 'string' ? taskOrId : taskOrId.id))

// Computed property to check if task has changed since last link generation
const hasTaskChanged = computed(() => {
  return (
    sharedSourceUrl.value &&
    lastGeneratedTaskId.value &&
    taskId.value !== lastGeneratedTaskId.value &&
    !hasTaskChangeWarningDismissed.value
  )
})

const selectedTaskList = asyncComputed(
  async () => {
    if (single) {
      if (typeof taskOrId === 'string') {
        const task = await tystate.taskyonClient.task.get({ id: taskId.value })
        return task ? [task] : []
      }
      return [taskOrId]
    }
    const taskList = tystate.taskyonClient.taskModel.selection(taskId.value)
    return taskList
  },
  [],
  [taskId],
)
const copyableTaskList = computed(() =>
  selectTasksForChatCopy(
    selectedTaskList.value,
    tystate.allTools,
    state.appConfiguration.expertMode,
  ),
)

// Watch for taskId changes and reset warning dismissal
watch(
  () => taskId.value,
  (newTaskId, oldTaskId) => {
    if (newTaskId !== oldTaskId) {
      hasTaskChangeWarningDismissed.value = false
      // Keep the published snapshot until the user chooses to replace it.
    }
  },
)

const taskyonShareLink = computed(() => {
  if (!sharedSourceUrl.value) throw new Error('Choose a public source URL before sharing.')
  return `${baseURL}/chat?url=${encodeURIComponent(sharedSourceUrl.value)}`
})

function usePublicUrl() {
  try {
    const source = validateSandboxFetchUrl(providedSourceUrl.value.trim())
    if (source.protocol !== 'https:') throw new Error('Public share URLs must use HTTPS.')
    publicChatDownloadUrl(source.toString())
    sharedSourceUrl.value = source.toString()
    lastGeneratedTaskId.value = undefined
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function onExportPublicGdrive(taskList: TaskNode[]) {
  try {
    loadingGdrive.value = true
    const selectedId = taskId.value
    if (!single) taskList = await tystate.taskyonClient.taskModel.exportSelection(selectedId)
    if (taskList.length > 0) {
      loadingGdrive.value = true
      const taskThreadMd = chat2Md(taskList, true, { leafID: selectedId })
      const task = taskList.at(-1)!
      if (taskThreadMd) {
        const { publishMarkdown } = useGdrive(tystate.getGdriveToken)

        const gdriveFile = await publishMarkdown(
          taskThreadMd,
          state.appConfiguration.gdriveDir + '/share',
          `ty-${task.name || ''}.${task.id}.md`,
          true,
        )

        if (!gdriveFile.webViewLink)
          throw new Error('Google Drive did not return a public share URL')
        sharedSourceUrl.value = gdriveFile.webViewLink
        lastGeneratedTaskId.value = selectedId
        hasTaskChangeWarningDismissed.value = false
      }
    }
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loadingGdrive.value = false
  }
}

async function regenerateGdriveLink() {
  hasTaskChangeWarningDismissed.value = false
  await onExportPublicGdrive(selectedTaskList.value)
}

function dismissTaskChangeWarning() {
  hasTaskChangeWarningDismissed.value = true
}

async function onExportChatMD(taskList: TaskNode[]) {
  const selectedId = taskId.value
  try {
    if (!single) taskList = await tystate.taskyonClient.taskModel.exportSelection(selectedId)
    if (taskList.length > 0) {
      const taskThreadMd = chat2Md(taskList, true, { leafID: selectedId })
      const task = taskList.at(-1)!
      if (taskThreadMd) {
        const fileName = `tyn-${task.name || ''}.md`
        const mimeType = 'text/markdown; charset=UTF-8'

        await saveFile(fileName, mimeType, () => taskThreadMd)
      }
    }
  } catch {
    $q.notify({
      type: 'negative',
      message: 'The complete conversation could not be loaded. Please retry.',
    })
  }
}

async function onExportChatYaml(taskList: TaskNode[]) {
  const selectedId = taskId.value
  try {
    if (!single) taskList = await tystate.taskyonClient.taskModel.exportSelection(selectedId)
    if (taskList.length > 0) {
      const taskThreadYaml = chatToYaml(taskList, { leafID: selectedId })
      const task = taskList.at(-1)!
      if (taskThreadYaml) {
        const fileName = `tyn-${task.name || ''}.yaml`
        const mimeType = 'text/yaml'

        await saveFile(fileName, mimeType, () => taskThreadYaml)
      }
    }
  } catch {
    $q.notify({
      type: 'negative',
      message: 'The complete conversation could not be loaded. Please retry.',
    })
  }
}

const $q = useQuasar()

function shareViaSocialApps() {
  if (navigator.share && sharedSourceUrl.value) {
    navigator
      .share({
        title: 'Share Taskyon Chat',
        text: 'Check out this chat!',
        url: taskyonShareLink.value,
      })
      .catch((error) =>
        $q.notify({
          message: 'Error sharing: ' + JSON.stringify(error),
          position: 'center',
          type: 'negative',
          closeBtn: true,
          timeout: 0,
        }),
      )
  } else {
    $q.notify({
      message: 'Sharing not supported on this device.',
      position: 'center',
      type: 'negative',
    })
  }
}
</script>
