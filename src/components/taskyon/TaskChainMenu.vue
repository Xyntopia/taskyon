<template>
  <q-btn
    flat
    unelevated
    round
    dense
    :icon="matMoreHoriz"
  >
    <q-menu class="column q-gutter-sm q-pa-xs" auto-close>
      <q-btn
        flat
        dense
        label="Cownload Chat"
        :icon="matDownloadForOffline"
        size="sm"
        to="/"
        @click="onDownloadChat(conversationId)"
      >
      </q-btn>
      <q-btn
        dense
        :icon="matDelete"
        size="sm"
        flat
        label="Delete Conversation"
        @click="onDeleteThread(conversationId)"
      >
      </q-btn>
    </q-menu>
  </q-btn>
</template>

<script setup lang="ts">
import {
  matDownloadForOffline,
  matDelete,
  matMoreHoriz,
} from '@quasar/extras/material-icons';
import { useTaskyonStore } from 'stores/taskyonState';
import { exportFile } from 'quasar';

const state = useTaskyonStore();

defineProps<{
  conversationId: string;
}>();

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await state.getTaskManager();
  state.llmSettings.selectedTaskId = undefined;
  tm.deleteTaskThread(conversationId);
  state.chatHistory = state.chatHistory.filter((id) => id != conversationId);
}

async function onDownloadChat(conversationId: string) {
  console.log('download thread!!', conversationId);
  const tm = await state.getTaskManager();
  const task = await tm.getTask(conversationId);
  if (task) {
    const taskThreadYaml = await tm.chatToYaml(task.id);
    if (taskThreadYaml) {
      const fileName = `tyn-${task.name || ''}.yaml`;
      const mimeType = 'text/yaml';

      // Use Quasar's exportFile function for download
      exportFile(fileName, taskThreadYaml, mimeType);
    }
  }
}
</script>
