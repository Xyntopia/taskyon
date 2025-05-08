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
        <q-icon name="svguse:/taskyon_mono_opt.svg#taskyon" size="sm" />
        <div>Conversations</div>
      </div>
      <q-separator v-if="!state.minimalGui" spaced />
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
            >
              {{
                (state.llmSettings.selectedTaskId == conversationId ? '> ' : '') +
                  nameMap[conversationId] || `chat.${conversationId.slice(0, 3)}`
              }}
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
          <FileDropzone accept="*" disable-dropzone-border @add-files="loadYamlConversation">
            <q-btn dense class="fit" flat>
              <q-icon :name="matFileUpload" />
              <q-tooltip>Upload Chat</q-tooltip>
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
    <q-separator v-if="!state.minimalGui" spaced />
    <!-- Settings Area -->
    <q-item v-if="!state.minimalGui" class="fit column items-center">
      <SimpleSettings class="col-auto" vertical reduced></SimpleSettings>
    </q-item>
    <q-item v-if="!state.minimalGui" class="fit">
      <div class="row">
        <div>
          <q-btn
            v-if="state.appConfiguration.expertMode"
            dense
            flat
            :icon="mdiTools"
            label="Tools"
            to="/tools"
          ></q-btn>
        </div>
        <div>
          <q-btn
            v-if="state.appConfiguration.expertMode"
            dense
            flat
            :icon="mdiRobotConfusedOutline"
            label="Customize"
            to="/prompts"
          ></q-btn>
        </div>
        <div>
          <q-btn
            v-if="state.appConfiguration.expertMode"
            dense
            flat
            :icon="mdiSubdirectoryArrowRight"
            label="Detailed Task View"
            to="/detailed"
          ></q-btn>
        </div>
        <div>
          <q-btn
            flat
            dense
            :icon="matManageAccounts"
            label="AI Service"
            to="/settings/aiserviceprovider"
          ></q-btn>
        </div>
      </div>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import SimpleSettings from './SimpleSettings.vue'
import { useTaskyonStore } from 'stores/taskyonState'
import FileDropzone from 'components/FileDropzone.vue'
import { matSearch, matManageAccounts, matFileUpload } from '@quasar/extras/material-icons'
import {
  mdiTools,
  mdiRobotConfusedOutline,
  mdiForumPlus,
  mdiSubdirectoryArrowRight,
} from '@quasar/extras/mdi-v6'
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

async function loadYamlConversation(files: File[]) {
  const tm = await tystate.getTaskManager()
  let last_loaded_id = undefined
  for (const file of files) {
    last_loaded_id = await tm.loadYamlConversation(file)
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
