<template>
  <div
    class="row justify-start items-stretch"
  >
    <q-btn
      v-if="'message' in task.content"
      class="col-auto"
      icon="content_copy"
      dense
      flat
      size="sm"
      @click="copyToClipboard(task.content.message || '')"
    >
      <q-tooltip :delay="0">Copy raw text.</q-tooltip>
    </q-btn>
    <q-btn
      v-if="'message' in task.content"
      class="col-auto"
      :icon="
        state.taskState[task.id]?.markdownEnabled != false
          ? 'mdi-language-markdown'
          : 'raw_on'
      "
      dense
      flat
      size="sm"
      @click="toggleMarkdown(task.id)"
    >
      <q-tooltip :delay="0">Toggle Markdown</q-tooltip>
    </q-btn>
    <q-separator v-if="'message' in task.content" vertical class="q-mx-sm" />
    <q-btn
      v-if="'message' in task.content"
      class="col-auto"
      size="sm"
      dense
      flat
      @click="createNewConversation(task.id)"
    >
      <q-icon name="mdi-star-four-points" size="xs"></q-icon>
      <q-tooltip :delay="0"> Start a new thread with this message! </q-tooltip>
    </q-btn>
    <q-btn
      v-if="task.childrenIDs.length > 0"
      class="col-auto"
      size="sm"
      dense
      flat
      @click="state.chatState.selectedTaskId = task.id"
    >
      <q-icon class="rotate-180" name="alt_route"></q-icon>
      <q-tooltip :delay="0"
        >Start alternative conversation branch from here</q-tooltip
      >
    </q-btn>
    <q-btn
      v-if="'message' in task.content || 'functionCall' in task.content"
      class="col-auto"
      icon="edit"
      dense
      flat
      size="sm"
      @click="editTask(task.id)"
    >
      <q-tooltip :delay="0">Edit Task/Message</q-tooltip>
    </q-btn>
    <q-separator
      v-if="state.appConfiguration.expertMode"
      vertical
      class="q-mx-sm"
    />
    <q-btn
      v-if="state.appConfiguration.expertMode"
      class="col-auto"
      icon="code"
      dense
      flat
      size="sm"
      @click="toggleMessageDebug(task.id)"
    >
      <q-tooltip :delay="0">Show message context</q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import type { LLMTask } from 'src/modules/taskyon/types';
import { useTaskyonStore } from 'src/stores/taskyonState';

const state = useTaskyonStore();

defineProps<{
  task: LLMTask;
  toggleMarkdown: (id: string) => void;
  createNewConversation: (taskId: string) => Promise<void>;
  editTask: (taskId: string) => Promise<void>;
  toggleMessageDebug: (id: string) => void;
}>();

function copyToClipboard(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      console.log('Copied to clipboard');
    })
    .catch((err) => {
      console.error('Error in copying text: ', err);
    });
}
</script>
