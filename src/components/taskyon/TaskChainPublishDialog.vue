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
          <div class="text-h5 row items-center">
            <q-icon class="q-pr-md" :name="matShare" />
            <div>Select Method for Sharing This Chat</div>
          </div>
          <div class="column q-gutter-sm q-pt-md">
            <q-btn
              v-if="false"
              outline
              :icon="matLink"
              label="Create Public Link"
            />
            <q-btn
              v-if="false"
              outline
              :icon="symOutlinedPublic"
              label="Share with public link"
              @click="onExportIpfs(conversationId)"
            />
            <q-btn
              outline
              :icon="symOutlinedDriveExport"
              label="Share through Gdrive"
              :loading="loadingGdrive"
              @click="onExportPublicGdrive(conversationId)"
            />
            <q-slide-transition v-if="gdriveLink">
              <div v-show="gdriveLink">
                <div
                  s
                  v-for="[link, label] in [
                    [
                      taskyonShareLink,
                      'Copy taskyon.space link (stored in gdrive)',
                    ],
                    [gdriveLink, 'Copy markdown link'],
                  ] as Array<[string, string]>"
                  :key="link"
                >
                  <div class="text-caption">{{ label }}</div>
                  <div class="row q-gutter-sm q-py-sm items-center">
                    <div
                      class="col-auto ellipsis text-weight-medium"
                      style="max-width: 15rem"
                    >
                      {{ link }}
                      <q-tooltip>{{ link }}</q-tooltip>
                    </div>
                    <div class="col-auto">
                      <q-btn
                        flat
                        dense
                        :icon="matContentCopy"
                        @click="copyToClipboard(link || '')"
                      />
                    </div>
                  </div>
                </div>
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
import {
  matShare,
  matLink,
  matCopyAll,
  matContentCopy,
} from '@quasar/extras/material-icons';
import { copyToClipboard, exportFile } from 'quasar';
import { ref, computed } from 'vue';
import {
  symOutlinedDriveExport,
  symOutlinedFileSave,
  symOutlinedMarkdown,
  symOutlinedPublic,
} from '@quasar/extras/material-symbols-outlined';
import { getFileId, useGdrive } from 'src/modules/gdrive';
import { useAppStateStore } from 'src/stores/appState';
import { useTaskyonStore } from 'src/stores/taskyonState';

const showDialog = ref(false);

const state = useAppStateStore();
const tystate = useTaskyonStore();

defineProps<{
  conversationId: string;
}>();

const gdriveLink = ref<string>();
const loadingGdrive = ref(false);

const taskyonShareLink = computed(() => {
  if (gdriveLink.value) {
    const fileId = getFileId(gdriveLink.value);
    return `${window.origin}/chat?gd=${fileId}`;
  } else {
    throw new Error('Could not creae ');
  }
});

async function onExportPublicGdrive(conversationId: string) {
  const tm = await tystate.getTaskManager();
  const task = await tm.getTask(conversationId);
  try {
    if (task) {
      loadingGdrive.value = true;
      const taskThreadMd = await tm.chatToMarkdown(task.id);
      if (taskThreadMd) {
        const { publishMarkdown } = useGdrive();

        const gdriveFile = await publishMarkdown(
          taskThreadMd,
          state.appConfiguration.gdriveDir,
          `tyn-${task.name || ''}.md`,
          true,
        );

        if (gdriveFile.webViewLink) {
          gdriveLink.value = gdriveFile.webViewLink;
        }
      }
    }
  } finally {
    loadingGdrive.value = false;
  }
}

async function onExportIpfs(conversationId: string) {
  console.log('export to ipfs', conversationId);
}

async function onExportChatMD(conversationId: string, clipBoard = false) {
  const tm = await tystate.getTaskManager();
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
