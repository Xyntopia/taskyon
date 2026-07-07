<!-- Sidebar -->
<template>
  <q-list dense class="chat-sidebar q-pa-xs">
    <!-- Conversation Area -->
    <div class="chat-sidebar__section">
      <!--div class="col-auto">
        <q-expansion-item dense :icon="matToc" label="Chat Content">
          <table-of-chat-content />
        </q-expansion-item>
      </div-->
      <div v-if="localDev" class="chat-sidebar__dev text-caption q-px-sm q-pb-xs">
        profile: {{ state.activeProfileName }} | session:
        {{ state.sessionId?.slice(0, 10) || 'N/A' }}
      </div>
      <div class="chat-sidebar__header q-pa-xs text-caption row justify-center items-center">
        <q-icon
          v-if="state.minimalGui === 'default'"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          size="sm"
        />
        <div>Conversations</div>
      </div>
      <q-separator v-if="state.minimalGui === 'default'" class="chat-sidebar__separator" spaced />
      <div class="chat-sidebar__content column items-stretch">
        <q-list dense class="chat-sidebar__conversation-list">
          <q-item
            v-for="conversationId in conversationIDs"
            :key="conversationId"
            :class="[
              'chat-sidebar__conversation',
              { 'chat-sidebar__conversation--active': state.selectedTaskId === conversationId },
            ]"
            clickable
            :to="{
              path: $route.path === '/detailed' ? '/detailed' : '/chat',
              query: { t: conversationId },
            }"
          >
            <!-- clickable   q-item-section avatar>
              <q-icon name="matChatBubble" size="xs" />
            </!q-item-section-->
            <q-item-section
              lines
              :class="[
                'chat-sidebar__conversation-title',
                {
                  'chat-sidebar__conversation-title--active':
                    state.selectedTaskId === conversationId,
                },
              ]"
              ><template v-if="nameMap[conversationId]">
                {{ nameMap[conversationId] }}
              </template>
              <div v-else class="chat-sidebar__pending-name row no-wrap items-center">
                <q-icon :name="matAutorenew" class="q-mr-sm" />
                {{ `chat.${conversationId.slice(0, 3)}` }}
              </div>
              <q-tooltip>
                <div>Select Conversation ( id: {{ conversationId.slice(0, 5) }} ...)</div>
                <div v-if="!nameMap[conversationId]" class="q-mt-sm">
                  ... Conversation doesn't have a name, searching for keywords in conversation...
                </div>
              </q-tooltip>
            </q-item-section>
            <q-item-section side class="chat-sidebar__conversation-menu">
              <TaskChainMenu :conversation-id="conversationId" />
            </q-item-section>
          </q-item>
        </q-list>
        <div class="chat-sidebar__actions row justify-around items-center">
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
          <q-btn
            dense
            flat
            :icon="mdiForumPlus"
            class="chat-sidebar__action-button"
            @click="navigateToTask(undefined, { path: '/' })"
          >
            <q-tooltip> Create a new conversation </q-tooltip>
          </q-btn>
          <q-btn dense flat :icon="matSearch" to="/TaskManager" class="chat-sidebar__action-button"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
      </div>
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
import { matAutorenew, matFileUpload, matSearch } from '@quasar/extras/material-icons'
import { mdiForumPlus, mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import FileDropzone from '@taskyon/ui/components/FileDropzone.vue'
import { generateTaskKeyWords, type TaskNode } from '@taskyon/taskyon'
import { createTaskChainFromMarkdown } from '@taskyon/tyclient'
import { watchThrottled } from '@vueuse/core'
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

const conversationIDs = ref<string[]>([])
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
async function updateName(id: string) {
  console.log('update name...', id)
  const task = await tystate.taskyonClient.task.get({ id })
  if (!task) return

  const ty = await tystate.taskyon
  const taskMeta = await ty.getMeta(id)
  const cachedName = taskMeta?.name?.trim()
  if (cachedName) {
    nameMap.value[id] = cachedName
    return
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
}

watchThrottled(
  [() => state.selectedTaskId, () => state.chatHistory],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ([_, newChatHistory]) => {
    console.log('updating sidebar chat list')
    conversationIDs.value = newChatHistory.slice(0, 10)
    for (const cid of conversationIDs.value) {
      void updateName(cid)
    }
  },
  {
    immediate: true,
    throttle: 1000,
  },
)

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
