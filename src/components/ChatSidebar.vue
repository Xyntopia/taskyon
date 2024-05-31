<!-- Sidebar -->
<template>
  <q-list dense class="q-pa-xs">
    <!-- Conversation Area -->
    <q-item
      v-ripple
      default-opened
      hide-expand-icon
      clickable
      @click="state.drawerOpen = !state.drawerOpen"
    >
      <div class="col row q-gutter-sm items-end justify-around">
        <q-icon
          class="col-auto"
          name="svguse:taskyon_mono_opt.svg#taskyon"
          size="sm"
        />
        <div class="col-auto text-weight-medium">Conversation Threads</div>
        <q-icon class="col-auto" :name="matMenu" size="sm" />
      </div>
    </q-item>
    <div class="q-pt-md">
      <div class="column items-stretch">
        <q-list>
          <q-item
            dense
            v-for="conversationId in conversationIDs"
            :key="conversationId.id"
            @click="state.llmSettings.selectedTaskId = conversationId.id"
            to="/"
            clickable
            v-ripple
          >
            <!--q-item-section avatar>
              <q-icon name="matChatBubble" size="xs" />
            </!q-item-section-->
            <q-item-section
              v-for="(selected, idx) in [
                state.llmSettings.selectedTaskId == conversationId.id,
              ]"
              :key="idx"
              lines
              :class="
                selected
                  ? [
                      'text-weight-bolder',
                      $q.dark.isActive ? 'text-secondary' : 'text-black',
                    ]
                  : [$q.dark.isActive ? 'text-white' : 'text-primary']
              "
            >
              {{
                selected
                  ? '> ' + activeTask?.name
                  : conversationId.name ||
                    'Thread' + conversationId.id.substring(0, 3)
              }}
              <q-tooltip> Select Conversation </q-tooltip>
            </q-item-section>
            <q-item-section side>
              <div>
                <q-btn
                  v-if="state.llmSettings.selectedTaskId == conversationId.id"
                  flat
                  dense
                  :icon="matDownloadForOffline"
                  size="sm"
                  to="/"
                  @click="onDownloadChat(conversationId.id)"
                  ><q-tooltip>Download Chat</q-tooltip>
                </q-btn>
                <q-btn
                  dense
                  :icon="matDelete"
                  size="sm"
                  flat
                  @click="onDeleteThread(conversationId.id)"
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
            @update:model-value="loadConversation"
            accept="*"
            disable-dropzone-border
          >
            <q-btn dense class="fit" flat>
              <q-icon :name="matFileUpload" />
              <q-tooltip>Upload Chat</q-tooltip>
            </q-btn>
          </FileDropzone>
          <q-btn
            dense
            flat
            @click="state.llmSettings.selectedTaskId = undefined"
            to="/"
          >
            <q-icon :name="matAdd" />
            <q-tooltip> Create a new conversation </q-tooltip>
          </q-btn>
          <q-btn dense flat :icon="matSearch" to="/TaskManager"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
      </div>
    </div>
    <q-separator spaced />
    <!-- Settings Area -->
    <q-item class="fit column items-center">
      <SimpleSettings class="col-auto" vertical reduced></SimpleSettings>
    </q-item>
    <q-item>
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
        label="Prompts"
        to="/prompts"
      ></q-btn>
      <q-btn
        flat
        dense
        :icon="matManageAccounts"
        label="Accounts"
        to="/settings/llmproviders"
      ></q-btn>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  deleteTaskThread,
  TyTaskManager,
} from 'src/modules/taskyon/taskManager';
import SimpleSettings from 'components/SimpleSettings.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { LLMTask, TaskListType } from 'src/modules/taskyon/types';
import { exportFile } from 'quasar';
import { dump, load } from 'js-yaml';
import FileDropzone from 'components/FileDropzone.vue';

import {
  matDownloadForOffline,
  matDelete,
  matSearch,
  matManageAccounts,
  matMenu,
  matFileUpload,
  matAdd,
} from '@quasar/extras/material-icons';
import { mdiTools, mdiRobotConfusedOutline } from '@quasar/extras/mdi-v6';

const state = useTaskyonStore();

type taskEntry = { id: string; name: string | undefined };

const conversationIDs = ref<taskEntry[]>([]);

async function getLeafTaskNames(tm: TyTaskManager) {
  const leafTaskIds = tm.getLeafTasks().reverse().slice(0, 10);
  let taskList: taskEntry[] = [];
  for (const id of leafTaskIds) {
    taskList.push({ id, name: (await tm.getTask(id))?.name });
  }
  return taskList;
}

const activeTask = ref<LLMTask | undefined>();

watch(
  () => state.llmSettings.selectedTaskId,
  async (newTaskId) => {
    const tm = await state.getTaskManager();
    if (newTaskId) {
      activeTask.value = await tm.getTask(newTaskId);
    }
  }
);

void state.getTaskManager().then(async (tm) => {
  tm.subscribeToTaskChanges(() => {
    console.log('update threads!!');
    void getLeafTaskNames(tm).then((res) => {
      conversationIDs.value = res;
    });
  }, true);
  conversationIDs.value = await getLeafTaskNames(tm);
});

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await state.getTaskManager();
  state.llmSettings.selectedTaskId = undefined;
  await deleteTaskThread(conversationId, tm);
  conversationIDs.value = await getLeafTaskNames(tm);
}

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

async function loadConversation(files: File[]) {
  if (files) {
    console.log('adding files to our conversations!');

    const tm = await state.getTaskManager();
    let last_task_id: string | undefined = undefined;
    for (let i = 0; i < files.length; i++) {
      console.log(files[i]);
      const fileStr = await files[i].text();
      const taskListRaw = load(fileStr);
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
