<!-- Sidebar -->
<template>
  <q-list dense class="q-pa-xs">
    <!-- Conversation Area -->
    <div>
      <!--div class="col-auto">
        <q-expansion-item dense :icon="matToc" label="Chat Content">
          <table-of-chat-content />
        </q-expansion-item>
      </div-->
      <div class="q-pa-xs text-caption row justify-center items-center q-gutter-md">
        <q-icon
          v-if="state.minimalGui === 'default'"
          name="svguse:/taskyon_mono_opt.svg#taskyon"
          size="sm"
        />
        <div>Conversations</div>
      </div>
      <q-separator v-if="state.minimalGui === 'default'" spaced />
      <div class="column items-stretch">
        <q-list dense>
          <q-item
            v-for="conversationId in conversationIDs"
            :key="conversationId"
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
              :class="
                state.llmSettings.selectedTaskId == conversationId
                  ? ['text-weight-bolder', $q.dark.isActive ? 'text-secondary' : 'text-primary']
                  : [$q.dark.isActive ? 'text-white' : 'text-primary']
              "
              ><template v-if="nameMap[conversationId]">
                {{
                  (state.llmSettings.selectedTaskId == conversationId ? '> ' : '') +
                  nameMap[conversationId]
                }}
              </template>
              <div v-else class="no-wrap">
                <q-spinner-dots />
                {{ `chat.${conversationId.slice(0, 3)}` }}
              </div>
              <q-tooltip>
                Select Conversation ( id: {{ conversationId.slice(0, 5) }} ...)</q-tooltip
              >
            </q-item-section>
            <q-item-section side>
              <TaskChainMenu :conversation-id="conversationId" />
            </q-item-section>
          </q-item>
        </q-list>
        <div class="row justify-around items-center">
          <FileDropzone
            accept="text/markdown,application/x-yaml,text/yaml,.md,.markdown,.yaml,.yml"
            disable-dropzone-border
            @add-files="loadConversations"
          >
            <q-btn dense class="fit" flat>
              <q-icon :name="matFileUpload" />
              <q-tooltip>
                Upload a Taskyon chat exported as **Markdown (`.md`)** or **YAML (`.yaml`)**.
              </q-tooltip>
            </q-btn>
          </FileDropzone>
          <q-btn dense flat to="/" :icon="mdiForumPlus" @click="state.setSelectedTask(null)">
            <q-tooltip> Create a new conversation </q-tooltip>
          </q-btn>
          <q-btn dense flat :icon="matSearch" to="/TaskManager"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
      </div>
    </div>
    <q-separator v-if="state.minimalGui === 'default'" spaced />
    <!-- Settings Area -->
    <q-item v-if="state.appConfiguration.expertMode && state.minimalGui === 'default'" class="fit">
      <div class="row">
        <div>
          <q-btn
            dense
            flat
            :icon="mdiSubdirectoryArrowRight"
            label="Detailed Task View"
            to="/detailed"
          ></q-btn>
        </div>
      </div>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTaskyonStore } from 'stores/taskyonState'
import FileDropzone from 'components/FileDropzone.vue'
import { matSearch, matFileUpload } from '@quasar/extras/material-icons'
import { mdiForumPlus, mdiSubdirectoryArrowRight } from '@quasar/extras/mdi-v6'
import TaskChainMenu from './TaskChainMenu.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useQuasar } from 'quasar'
import { useRoute } from 'vue-router'
import { watchEffect } from 'vue'

const $route = useRoute()
const $q = useQuasar()
const state = useAppStateStore()
const tystate = useTaskyonStore()

watchEffect(() => {
  console.log(
    'currentTask changed in sidebar:',
    tystate.currentTask.value,
    tystate.currentTask.value?.name,
  )
})

const conversationIDs = ref<string[]>([])
const nameMap = ref<Record<string, string>>({})

void tystate.getTaskManager().then((tm) =>
  tm.taskStream.subscribe((data) => {
    // for every message from the stream, try to update our name map :)
    // console.log('update name', data.data)
    nameMap.value[data.id] = data.data?.name || 'undefined'
  }),
)

async function updateName(id: string) {
  if (!(id in nameMap.value)) {
    const tm = await tystate.getTaskManager()
    const name = (await tm.getTask(id))?.name
    if (name) {
      nameMap.value[id] = name
    }
  }
}

watch(
  [() => state.llmSettings.selectedTaskId, () => state.chatHistory],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ([_, newChatHistory]) => {
    console.log('updating sidebar chat list')
    conversationIDs.value = newChatHistory.slice(0, 10)
    conversationIDs.value.forEach((id) => void updateName(id))
  },
  {
    immediate: true,
  },
)

const q = useQuasar()

async function loadConversations(files: File[]) {
  console.log('load conversation from file', files)
  const tm = await tystate.getTaskManager()
  let last_loaded_id = undefined
  for (const file of files) {
    try {
      if (file.type === 'text/markdown') {
        last_loaded_id = await tm.addMdTaskChain(await file.text())
      } else if (file.type === 'application/yaml') {
        last_loaded_id = await tm.loadYamlConversation(file)
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
  state.setSelectedTask(last_loaded_id || null)
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
