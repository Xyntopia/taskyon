<!-- Sidebar -->
<template>
  <q-list dense class="q-pa-xs">
    <!-- Conversation Area -->
    <div>
      <div
        class="q-pa-xs text-caption row justify-center items-center q-gutter-md"
      >
        <q-icon name="svguse:/taskyon_mono_opt.svg#taskyon" size="sm" />
        <div>Conversations</div>
      </div>
      <div class="column items-stretch">
        <q-list dense>
          <q-item
            v-for="conversationId in conversationIDs"
            :key="conversationId"
            v-ripple
            to="/"
            clickable
            @click="state.llmSettings.selectedTaskId = conversationId"
          >
            <!--q-item-section avatar>
              <q-icon name="matChatBubble" size="xs" />
            </!q-item-section-->
            <q-item-section
              v-for="(selected, idx) in [
                state.llmSettings.selectedTaskId == conversationId,
              ]"
              :key="idx"
              lines
              :class="
                selected
                  ? [
                      'text-weight-bolder',
                      $q.dark.isActive ? 'text-secondary' : 'text-primary',
                    ]
                  : [$q.dark.isActive ? 'text-white' : 'text-primary']
              "
            >
              {{
                selected
                  ? `> ${state.currentTask?.name}`
                  : nameMap[conversationId] ||
                    `chat.${conversationId.slice(0, 3)}`
              }}
              <q-tooltip> Select Conversation </q-tooltip>
            </q-item-section>
            <q-item-section side>
              <div>
                <q-btn
                  v-if="state.llmSettings.selectedTaskId == conversationId"
                  flat
                  dense
                  :icon="matDownloadForOffline"
                  size="sm"
                  to="/"
                  @click="onDownloadChat(conversationId)"
                  ><q-tooltip>Download Chat</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  :icon="matDelete"
                  size="sm"
                  flat
                  @click="onDeleteThread(conversationId)"
                >
                  <q-tooltip anchor="center right" self="center left">
                    Delete Conversation
                  </q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
        <div class="row justify-around items-center">
          <FileDropzone
            accept="*"
            disable-dropzone-border
            @update:model-value="loadConversation"
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
import { ref, reactive, watch } from 'vue';
import SimpleSettings from './SimpleSettings.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { TaskListType } from 'src/modules/taskyon/types';
import { exportFile } from 'quasar';
import { dump, load } from 'js-yaml';
import FileDropzone from 'components/FileDropzone.vue';
import {
  matDownloadForOffline,
  matDelete,
  matSearch,
  matManageAccounts,
  matFileUpload,
} from '@quasar/extras/material-icons';
import {
  mdiTools,
  mdiRobotConfusedOutline,
  mdiForumPlus,
} from '@quasar/extras/mdi-v6';

const state = useTaskyonStore();

const conversationIDs = ref<string[]>([]);
const nameMap = reactive<Record<string, string>>({});

async function updateName(id: string) {
  if (!(id in nameMap)) {
    const tm = await state.getTaskManager();
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

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await state.getTaskManager();
  state.llmSettings.selectedTaskId = undefined;
  tm.deleteTaskThread(conversationId);
  state.chatHistory = state.chatHistory.filter((id) => id != conversationId);
}

// TODO: move these functions here into taskmanagerin order to import/export
//       tasklists...
async function onDownloadChat(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await state.getTaskManager();
  const taskList = await tm.getTaskChain(conversationId);

  if (taskList.length) {
    const lastTask = taskList[taskList.length - 1];

    const fileName = `tyconv-${lastTask?.name || ''}.yaml`;
    const fileContent = dump(taskList);
    const mimeType = 'text/yaml';

    // Use Quasar's exportFile function for download
    exportFile(fileName, fileContent, mimeType);
  }
}

// TODO: move these functions here into taskmanagerin order to import/export
//       tasklists...
async function loadConversation(files: File[]) {
  if (files) {
    console.log('adding files to our conversations!');

    const tm = await state.getTaskManager();
    let last_task_id: string | undefined = undefined;
    for (let i = 0; i < files.length; i++) {
      console.log(files[i]);
      const fileStr = await files[i]?.text();
      const taskListRaw = fileStr ? load(fileStr) : [];
      const result = await TaskListType.safeParseAsync(taskListRaw);
      if (result.success) {
        const taskList = result.data;
        taskList.forEach((t) => {
          void tm.setTask(t, true);
          last_task_id = t.id;
        });
      }
    }
    state.llmSettings.selectedTaskId = last_task_id;
  }
}
</script>
