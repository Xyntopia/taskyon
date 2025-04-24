<template>
  <div class="row justify-start items-stretch">
    <q-btn
      v-if="task.content.type === 'message'"
      class="col-auto"
      :icon="symOutlinedMarkdownCopy"
      dense
      flat
      size="sm"
      aria-label="copy markdown text"
      @click="copyToClipboard(task.content.data || '')"
    >
      <q-tooltip :delay="0">Copy markdown text.</q-tooltip>
    </q-btn>
    <q-btn
      v-if="task.content.type === 'message'"
      class="col-auto"
      :icon="state.taskState[task.id]?.markdownEnabled != false ? mdiLanguageMarkdown : matRawOn"
      dense
      flat
      size="sm"
      @click="toggleMarkdown(task.id)"
    >
      <q-tooltip :delay="0">Markdown on/off</q-tooltip>
    </q-btn>
    <q-separator v-if="task.content.type === 'message'" vertical class="q-mx-sm" />
    <q-btn
      class="col-auto"
      size="sm"
      dense
      flat
      :icon="mdiForumPlus"
      @click="createNewConversation(task.id)"
    >
      <q-tooltip :delay="0">Start a new thread with this message! </q-tooltip>
    </q-btn>
    <q-btn
      class="col-auto"
      size="sm"
      dense
      flat
      :icon="mdiMessagePlus"
      @click="state.setSelectedTask(task.id)"
    >
      <q-tooltip :delay="0">Start alternative chat from here</q-tooltip>
    </q-btn>
    <q-btn
      v-if="task.content.type === 'message' || task.content.type === 'functioncall'"
      class="col-auto"
      :icon="matEdit"
      dense
      flat
      size="sm"
      @click="editTask(task.id)"
    >
      <q-tooltip :delay="0">Edit Task/Message</q-tooltip>
    </q-btn>
    <q-separator v-if="state.appConfiguration.expertMode" vertical class="q-mx-sm" />
    <q-btn
      v-if="state.appConfiguration.expertMode"
      class="col-auto"
      :icon="matCode"
      dense
      flat
      size="sm"
      aria-label="show message context"
      @click="toggleMessageDebug(task.id)"
    >
      <q-tooltip :delay="0">Show detailed task view</q-tooltip>
    </q-btn>
    <q-btn
      v-if="state.appConfiguration.expertMode"
      class="col-auto"
      :icon="mdiFileTree"
      dense
      flat
      size="sm"
      aria-label="show message in tree browser"
      :to="`/browser/${task.id}`"
    >
      <q-tooltip :delay="0">Show task tree</q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { matCode, matEdit, matRawOn } from '@quasar/extras/material-icons'
import {
  mdiFileTree,
  mdiForumPlus,
  mdiLanguageMarkdown,
  mdiMessagePlus,
} from '@quasar/extras/mdi-v6'
import { symOutlinedMarkdownCopy } from '@quasar/extras/material-symbols-outlined'
import type { TaskNode } from 'src/modules/taskyon/types'
import { copyToClipboard } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'

const state = useAppStateStore()

defineProps<{
  task: TaskNode
  toggleMarkdown: (id: string) => void
  createNewConversation: (taskId: string) => Promise<void>
  editTask: (taskId: string) => Promise<void>
  toggleMessageDebug: (id: string) => void
}>()
</script>
