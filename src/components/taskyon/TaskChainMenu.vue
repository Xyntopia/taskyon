<template>
  <q-btn flat unelevated round dense :icon="matMoreHoriz">
    <q-menu class="column q-gutter-sm q-pa-xs" auto-close>
      <q-list dense>
        <q-item clickable @click="onDownloadChat(conversationId)">
          <q-item-section> Download Chat </q-item-section>
          <q-item-section side>
            <q-icon :name="matDownloadForOffline"></q-icon>
          </q-item-section>
        </q-item>
        <q-item clickable @click="onDeleteThread(conversationId)">
          <q-item-section>
            <q-item-label> Delete Conversation </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-icon :name="matDelete"></q-icon>
          </q-item-section>
        </q-item>
      </q-list>
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
import { useAppStateStore } from 'src/stores/appState';

const tystate = useTaskyonStore();
const state = useAppStateStore();

defineProps<{
  conversationId: string;
}>();

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await tystate.getTaskManager();
  state.llmSettings.selectedTaskId = undefined;
  tm.deleteTaskThread(conversationId);
  state.chatHistory = state.chatHistory.filter((id) => id != conversationId);
}

async function onDownloadChat(conversationId: string) {
  console.log('download thread!!', conversationId);
  const tm = await tystate.getTaskManager();
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
