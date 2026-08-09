<!-- Sidebar -->
<template>
  <q-list dense class="chat-sidebar q-pa-xs">
    <div class="chat-sidebar__section">
      <div v-if="localDev" class="chat-sidebar__dev text-caption q-px-sm q-pb-xs">
        profile: {{ state.activeProfileName }} | session:
        {{ state.sessionId?.slice(0, 10) || 'N/A' }} | status: {{ state.taskyonSessionStatus }}
      </div>
      <TaskConversationBrowser
        :client="tystate.taskyonClient"
        :conversation-ids="state.chatHistory"
        :selected-task-id="state.selectedTaskId"
        :titles="nameMap"
        :resolve-title="updateName"
        @select="selectConversation"
        @new="navigateToTask(undefined, { path: '/' })"
      >
        <template #item-actions="{ conversationId }">
          <TaskChainMenu :conversation-id="conversationId" />
        </template>
        <template #actions-before>
          <FileDropzone
            accept="text/markdown,application/x-yaml,text/yaml,.md,.markdown,.yaml,.yml"
            disable-dropzone-border
            @add-files="loadConversations"
          >
            <q-btn dense class="fit chat-sidebar__action-button" flat>
              <q-icon :name="matFileUpload" />
              <q-tooltip>
                Upload a Taskyon chat exported as **Markdown (`.md`)** or **YAML (`.yaml`)**.
              </q-tooltip>
            </q-btn>
          </FileDropzone>
        </template>
        <template #actions-after>
          <q-btn dense flat :icon="matSearch" to="/TaskManager" class="chat-sidebar__action-button"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </template>
      </TaskConversationBrowser>
    </div>
    <q-separator v-if="state.minimalGui === 'default'" class="chat-sidebar__separator" spaced />
    <!-- Settings Area -->
    <q-item v-if="state.appConfiguration.expertMode" class="chat-sidebar__expert fit">
      <div class="row full-width">
        <div>
          <q-btn
            dense
            flat
            :icon="mdiSubdirectoryArrowRight"
            label="Detailed Task View"
            class="chat-sidebar__detail-button"
            :disable="!state.selectedTaskId"
            @click="openDetailedTaskView"
          ></q-btn>
        </div>
      </div>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { matFileUpload, matSearch } from '@quasar/extras/material-icons'
import { mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import FileDropzone from '@taskyon/ui/components/FileDropzone.vue'
import TaskConversationBrowser from '@taskyon/ui/components/taskyon/TaskConversationBrowser.vue'
import { generateTaskKeyWords, type TaskNode } from '@taskyon/taskyon'
import { createTaskChainFromMarkdown } from '@taskyon/tyclient'
import { useQuasar } from 'quasar'
import { useTaskNavigation } from 'src/composables/useTaskNavigation'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import TaskChainMenu from './TaskChainMenu.vue'

const localDev = process.env.DEV
const $route = useRoute()
const state = useAppStateStore()
const tystate = useTaskyonStore()
const { navigateToTask } = useTaskNavigation()

const nameMap = ref<Record<string, string>>({})
const namingInProgress = new Set<string>()

const openDetailedTaskView = () => {
  navigateToTask(state.selectedTaskId, { path: '/detailed' })
}

void tystate.taskyon.then((ty) =>
  ty.taskStream((data) => {
    // for every message from the stream, try to update our name map :)
    // console.log('update name', data.data)
    if (data.data?.name) nameMap.value[data.id] = data.data?.name
  }),
)

const firstExistingTaskName = (taskChain: { name?: string | undefined }[]) => {
  for (let i = taskChain.length - 1; i >= 0; i--) {
    const name = taskChain[i]?.name?.trim()
    if (name) return name
  }
}

const cacheName = async (id: string, name: string) => {
  const trimmedName = name.trim()
  if (!trimmedName) return

  nameMap.value[id] = trimmedName
  const ty = await tystate.taskyon
  void ty.metaUpsert(id, { name: trimmedName }, 'shallow_merge')
}

const generateLocalName = async (task: TaskNode, taskChain: TaskNode[]) =>
  (
    await generateTaskKeyWords(task, taskChain, {
      mode: 'first-words',
      maxWords: 4,
    })
  )[0]

const updateNameWithTextRank = async (id: string) => {
  if (namingInProgress.has(id)) return
  namingInProgress.add(id)

  try {
    const task = await tystate.taskyonClient.task.get({ id })
    if (!task) return

    const taskChain = await tystate.taskyonClient.task.getChain({ id })
    const kws = await generateTaskKeyWords(task, taskChain, {
      mode: 'textrank',
      maxWords: 4,
    })
    if (kws[0]) await cacheName(id, kws[0])
  } finally {
    namingInProgress.delete(id)
  }
}

// TODO: this is probably a good idea to move this into "taskyon core"
async function updateName(id: string): Promise<string | undefined> {
  console.log('update name...', id)
  const task = await tystate.taskyonClient.task.get({ id })
  if (!task) return undefined

  const ty = await tystate.taskyon
  const taskMeta = await ty.getMeta(id)
  const cachedName = taskMeta?.name?.trim()
  if (cachedName) {
    nameMap.value[id] = cachedName
    return cachedName
  }

  const taskChain = await tystate.taskyonClient.task.getChain({ id })
  const displayName =
    task.name?.trim() ||
    firstExistingTaskName(taskChain) ||
    (await generateLocalName(task, taskChain))

  if (displayName?.trim()) {
    nameMap.value[id] = displayName.trim()
  }
  void updateNameWithTextRank(id)
  return displayName?.trim()
}

const selectConversation = (taskId: string) => {
  navigateToTask(taskId, {
    path: $route.path === '/detailed' ? '/detailed' : '/chat',
  })
}

const q = useQuasar()

async function loadConversations(files: File[]) {
  console.log('load conversation from file', files)
  const ty = await tystate.taskyon
  let last_loaded_id = undefined
  for (const file of files) {
    try {
      if (file.type === 'text/markdown') {
        last_loaded_id = await createTaskChainFromMarkdown(tystate.taskyonClient, await file.text())
      } else if (file.type === 'application/yaml') {
        last_loaded_id = await ty.loadYamlConversation(file)
      } else {
        throw new Error(`wrong file type: ${file.type}`)
      }
    } catch (error) {
      console.log(error)
      q.notify({
        color: 'negative',
        position: 'top',
        message: `Invalid chat format (must be yaml or markdown and fulfill taskyon chat specification)`,
        icon: 'report_problem',
      })
    }
  }
  navigateToTask(last_loaded_id)
}

// const TableOfChatContent = defineAsyncComponent(
//   () =>
//     import(
//       /* webpackChunkName: "TableOfChatContent" */
//       /* webpackMode: "lazy" */
//       /* webpackFetchPriority: "low" */
//       'components/taskyon/TableOfChatContent.vue'
//     ),
// )
</script>
