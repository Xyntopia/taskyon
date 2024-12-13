<!-- Sidebar -->
<template>
  <q-list dense class="q-pa-xs">
    <!-- Conversation Area -->
    <div>
      <div class="q-pa-xs text-caption row justify-center items-center q-gutter-md">
        <q-icon name="svguse:/taskyon_mono_opt.svg#taskyon" size="sm" />
        <div>Conversations</div>
      </div>
      <div class="col-auto">
        <q-expansion-item dense :icon="matToc" label="Chat Content">
          <table-of-chat-content />
        </q-expansion-item>
      </div>
      <q-separator v-if="!state.minimalGui" spaced />
      <div class="column items-stretch">
        <q-list dense>
          <q-item
            v-for="conversationId in conversationIDs"
            :key="conversationId"
            clickable
            :to="{ path: '/chat', query: { t: conversationId } }"
          >
            <!--                          clickable   q-item-section avatar>
              <q-icon name="matChatBubble" size="xs" />
            </!q-item-section-->
            <q-item-section
              v-for="(selected, idx) in [state.llmSettings.selectedTaskId == conversationId]"
              :key="idx"
              lines
              :class="
                selected
                  ? ['text-weight-bolder', $q.dark.isActive ? 'text-secondary' : 'text-primary']
                  : [$q.dark.isActive ? 'text-white' : 'text-primary']
              "
            >
              {{
                selected
                  ? `> ${tystate.currentTask?.name}`
                  : nameMap[conversationId] || `chat.${conversationId.slice(0, 3)}`
              }}
              <q-tooltip> Select Conversation </q-tooltip>
            </q-item-section>
            <q-item-section side>
              <TaskChainMenu :conversation-id="conversationId" @click.stop />
            </q-item-section>
          </q-item>
        </q-list>
        <div class="row justify-around items-center">
          <FileDropzone
            accept="*"
            disable-dropzone-border
            @update:model-value="loadYamlConversation"
          >
            <q-btn dense class="fit" flat>
              <q-icon :name="matFileUpload" />
              <q-tooltip>Upload Chat</q-tooltip>
            </q-btn>
          </FileDropzone>
          <q-btn
            dense
            flat
            to="/"
            :icon="mdiForumPlus"
            @click="state.llmSettings.selectedTaskId = undefined"
          >
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
    <q-item v-if="!state.minimalGui">
      <q-btn
        v-if="state.appConfiguration.expertMode"
        dense
        flat
        :icon="mdiTools"
        label="Tools"
        to="/tools"
      ></q-btn>
      <q-btn
        v-if="state.appConfiguration.expertMode"
        dense
        flat
        :icon="mdiRobotConfusedOutline"
        label="Customize"
        to="/prompts"
      ></q-btn>
      <q-btn
        flat
        dense
        :icon="matManageAccounts"
        label="AI Service"
        to="/settings/aiserviceprovider"
      ></q-btn>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, reactive, watch, defineAsyncComponent } from 'vue';
import SimpleSettings from './SimpleSettings.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import FileDropzone from 'components/FileDropzone.vue';
import { matSearch, matManageAccounts, matFileUpload, matToc } from '@quasar/extras/material-icons';
import { mdiTools, mdiRobotConfusedOutline, mdiForumPlus } from '@quasar/extras/mdi-v6';
import TaskChainMenu from './TaskChainMenu.vue';
import { useAppStateStore } from 'src/stores/appState';
import { useQuasar } from 'quasar';

const $q = useQuasar();
const state = useAppStateStore();
const tystate = useTaskyonStore();

const conversationIDs = ref<string[]>([]);
const nameMap = reactive<Record<string, string>>({});

async function updateName(id: string) {
  if (!(id in nameMap)) {
    const tm = await tystate.getTaskManager();
    const name = (await tm.getTask(id))?.name;
    if (name) {
      nameMap[id] = name;
    }
  }
}

watch(
  [() => state.llmSettings.selectedTaskId, () => state.chatHistory],
  async ([newTaskId, newChatHistory]) => {
    console.log('updating sidebar chat list');
    if (newTaskId) {
      conversationIDs.value = newChatHistory.slice(0, 10);
      conversationIDs.value.forEach((id) => updateName(id));
    }
  },
  {
    immediate: true,
  },
);

async function loadYamlConversation(files: File[]) {
  const tm = await tystate.getTaskManager();
  let last_loaded_id = undefined;
  for (const file of files) {
    last_loaded_id = await tm.loadYamlConversation(file);
  }
  state.llmSettings.selectedTaskId = last_loaded_id;
}

const TableOfChatContent = defineAsyncComponent(
  () =>
    import(
      /* webpackChunkName: "TableOfChatContent" */
      /* webpackMode: "lazy" */
      /* webpackFetchPriority: "low" */
      'components/taskyon/TableOfChatContent.vue'
    ),
);
</script>
