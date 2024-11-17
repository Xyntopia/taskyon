<template>
  <q-btn
    class="gt-xs"
    v-bind="$attrs"
    :icon="matCopyAll"
    @click="onExportChatMD(conversationId, true)"
  >
    <q-tooltip>Copy entire chat as markdown</q-tooltip>
  </q-btn>
  <q-btn v-bind="$attrs" :icon="matShare" @click="showDialog = true">
    <q-tooltip>Share Content</q-tooltip>
    <q-dialog v-model="showDialog">
      <q-card>
        <q-card-section>
          <div class="text-h5">Select Method for Sharing This Chat</div>
          <div class="column q-gutter-xs q-pt-md">
            <q-btn
              v-if="false"
              outline
              :icon="matLink"
              label="Create Public Link"
            />
            <q-btn
              outline
              :icon="symOutlinedDriveExport"
              label="Share publicly using gdrive"
              @click="onExportPublicGdrive(conversationId)"
            />
            <q-slide-transition>
              <div v-show="gdriveLink">
                {{ gdriveLink ?? '' }} <q-btn :icon="matContentCopy" @click="copyToClipboard(gdriveLink || '')"/>
              </div>
            </q-slide-transition>
            <q-btn
              class="lt-sm"
              outline
              :icon="matCopyAll"
              label="Copy chat as markdown"
              @click="onExportChatMD(conversationId, true)"
            >
            </q-btn>
            <div class="text-caption col">or download as:</div>
            <q-btn
              outline
              :icon="symOutlinedMarkdown"
              label="Markdown"
              @click="onExportChatMD(conversationId)"
            />
            <q-btn
              outline
              :icon="symOutlinedFileSave"
              label="YAML"
              @click="onExportChatYaml(conversationId)"
            />
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Done" @click="showDialog = false"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-btn>
</template>

<script setup lang="ts">
import { matShare, matLink, matCopyAll, matContentCopy } from '@quasar/extras/material-icons';
import { useTaskyonStore } from 'stores/taskyonState';
import { copyToClipboard, exportFile } from 'quasar';
import { ref } from 'vue';
import {
  symOutlinedDriveExport,
  symOutlinedFileSave,
  symOutlinedMarkdown,
} from '@quasar/extras/material-symbols-outlined';
import { useGdrive } from 'src/modules/gdrive';
const showDialog = ref(true);

const state = useTaskyonStore();

defineProps<{
  conversationId: string;
}>();

const gdriveLink = ref<string>();

async function onExportPublicGdrive(conversationId: string) {
  const tm = await state.getTaskManager();
  const task = await tm.getTask(conversationId);
  if (task) {
    const taskThreadMd = await tm.chatToMarkdown(task.id);
    if (taskThreadMd) {
      const { publishMarkdown } = useGdrive();

      const gdriveFile = await publishMarkdown(
        taskThreadMd,
        state.appConfiguration.gdriveDir,
        `tyn-${task.name || ''}.md`,
        true,
      );

      gdriveLink.value = gdriveFile.webViewLink;
    }
  }
}

async function onExportChatMD(conversationId: string, clipBoard = false) {
  const tm = await state.getTaskManager();
  const task = await tm.getTask(conversationId);
  if (task) {
    const taskThreadMd = await tm.chatToMarkdown(task.id);
    if (taskThreadMd) {
      const fileName = `tyn-${task.name || ''}.md`;
      const mimeType = 'text/markdown; charset=UTF-8';

      if (clipBoard) {
        copyToClipboard(taskThreadMd);
      } else {
        // Use Quasar's exportFile function for download
        exportFile(fileName, taskThreadMd, mimeType);
      }
    }
  }
}

async function onExportChatYaml(conversationId: string) {
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
