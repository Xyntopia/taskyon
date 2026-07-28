<template>
  <template v-if="buttons">
    <CopyTaskChatButton class="gt-xs" v-bind="$attrs" :tasks="selectedTaskList">
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
        <q-banner v-if="hasTaskChanged && gdriveLink" class="q-mt-md" dense rounded>
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
            <q-btn v-if="false" outline :icon="matLink" label="Create Public Link" />
            <q-btn
              v-if="false"
              outline
              :icon="symOutlinedPublic"
              label="Share with public link"
              @click="onExportIpfs(taskId)"
            />
            <q-btn
              v-if="!gdriveLink"
              outline
              :icon="symOutlinedDriveExport"
              label="Share through Gdrive"
              :loading="loadingGdrive"
              @click="onExportPublicGdrive(selectedTaskList)"
            />
            <div v-else class="text-overline text-center q-pb-md">
              Gdrive Store & Share:
              <InfoDialog
                :info-text="`*Taskyon shares files using your Google Drive.*

You can always find and manage these files in your own Google Drive folder.
You have full control: if you delete a shared file from your Drive,
the sharing link will stop working.

This means only you decide what is shared and for how long.
No one else can access or remove your files without your permission.`"
              />
            </div>
            <q-slide-transition v-if="gdriveLink">
              <div v-show="gdriveLink" class="row q-gutter-md items-center justify-center">
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
                      [taskyonShareLink, 'Copy taskyon.space link (stored in gdrive)'],
                      [gdriveLink, 'Copy markdown link'],
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
            :tasks="selectedTaskList"
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
  symOutlinedPublic,
} from '@quasar/extras/material-symbols-outlined'
import InfoDialog from '@taskyon/ui/components/InfoDialog.vue'
import QrCode from '@taskyon/ui/components/QrCode.vue'
import CopyTaskChatButton from '@taskyon/ui/components/taskyon/CopyTaskChatButton.vue'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { chat2Md, chatToYaml, type TaskNode } from '@taskyon/taskyon'
import { exportFile, useQuasar } from 'quasar'
import { getFileId, useGdrive } from 'src/modules/gdrive'
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
const baseURL = process.env.DEV
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

const gdriveLink = ref<string>()
const loadingGdrive = ref(false)

// New state for tracking task changes
const lastGeneratedTaskId = ref<string>()
const linkGeneratedAt = ref<Date>()
const hasTaskChangeWarningDismissed = ref(false)

const taskId = computed(() => (typeof taskOrId === 'string' ? taskOrId : taskOrId.id))

// Computed property to check if task has changed since last link generation
const hasTaskChanged = computed(() => {
  return (
    gdriveLink.value &&
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
    const taskList = await tystate.taskyonClient.task.getChain({ id: taskId.value })
    return taskList
  },
  [],
  [taskId],
)

// Watch for taskId changes and reset warning dismissal
watch(
  () => taskId.value,
  (newTaskId, oldTaskId) => {
    if (newTaskId !== oldTaskId) {
      hasTaskChangeWarningDismissed.value = false
      // Only reset gdriveLink if we want to force regeneration
      // Comment out the line below if you want to keep the old link until manually regenerated
      // gdriveLink.value = undefined
    }
  },
)

const taskyonShareLink = computed(() => {
  if (gdriveLink.value) {
    const fileId = getFileId(gdriveLink.value)
    return `${baseURL}/chat?gd=${fileId}`
  } else {
    throw new Error('Could not create a taskyon share link!')
  }
})

async function onExportPublicGdrive(taskList: TaskNode[]) {
  try {
    if (taskList.length > 0) {
      loadingGdrive.value = true
      const taskThreadMd = chat2Md(taskList)
      const task = taskList.at(-1)!
      if (taskThreadMd) {
        const { publishMarkdown } = useGdrive(tystate.getGdriveToken)

        const gdriveFile = await publishMarkdown(
          taskThreadMd,
          state.appConfiguration.gdriveDir + '/share',
          `ty-${task.name || ''}.${task.id}.md`,
          true,
        )

        if (gdriveFile.webViewLink) {
          gdriveLink.value = gdriveFile.webViewLink
          lastGeneratedTaskId.value = taskId.value
          linkGeneratedAt.value = new Date()
          hasTaskChangeWarningDismissed.value = false
        }
      }
    }
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

function onExportIpfs(taskId: string) {
  console.log('export to ipfs', taskId)
}

function onExportChatMD(taskList: TaskNode[]) {
  if (taskList.length > 0) {
    const taskThreadMd = chat2Md(taskList)
    const task = taskList.at(-1)!
    if (taskThreadMd) {
      const fileName = `tyn-${task.name || ''}.md`
      const mimeType = 'text/markdown; charset=UTF-8'

      exportFile(fileName, taskThreadMd, mimeType)
    }
  }
}

function onExportChatYaml(taskList: TaskNode[]) {
  if (taskList.length > 0) {
    const taskThreadYaml = chatToYaml(taskList)
    const task = taskList.at(-1)!
    if (taskThreadYaml) {
      const fileName = `tyn-${task.name || ''}.yaml`
      const mimeType = 'text/yaml'

      // Use Quasar's exportFile function for download
      exportFile(fileName, taskThreadYaml, mimeType)
    }
  }
}

const $q = useQuasar()

function shareViaSocialApps() {
  if (navigator.share && gdriveLink.value) {
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
