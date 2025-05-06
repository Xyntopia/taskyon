<template>
  <div class="row justify-start items-stretch">
    <q-btn
      class="col-auto"
      :icon="matContentCopy"
      dense
      flat
      size="sm"
      aria-label="copy markdown text"
      @click="
        copyToClipboard(
          task.content.type === 'message'
            ? task.content.data || ''
            : JSON.stringify(task.content.data, null, 2),
        )
      "
    >
      <q-tooltip :delay="0">
        Copy {{ task.content.type === 'message' ? 'text (markdown)' : 'JSON' }}.
      </q-tooltip>
    </q-btn>
    <q-btn
      v-if="task.content.type === 'message' && state.appConfiguration.expertMode"
      class="col-auto"
      :icon="state.taskState[task.id]?.markdownEnabled != false ? mdiLanguageMarkdown : matRawOn"
      dense
      flat
      size="sm"
      @click="emit('toggle-markdown', task.id)"
    >
      <q-tooltip :delay="0">Markdown on/off</q-tooltip>
    </q-btn>
    <q-separator vertical class="q-mx-sm" />
    <q-btn
      class="col-auto"
      size="sm"
      dense
      flat
      :icon="mdiForumPlus"
      @click="emit('create_new_conversation', task.id)"
    >
      <q-tooltip :delay="0">Start a new thread with this message! </q-tooltip>
    </q-btn>
    <q-btn
      class="col-auto"
      size="sm"
      dense
      flat
      :icon="matAltRoute"
      @click="state.setSelectedTask(task.id)"
    >
      <q-tooltip :delay="0"
        >Start a new chat from here, keeping all previous messages up to this point.</q-tooltip
      >
    </q-btn>
    <q-btn
      v-if="
        task.content.type === 'message' ||
        task.content.type === 'functioncall' ||
        task.content.type === 'tooldefinition'
      "
      class="col-auto"
      :icon="matEdit"
      dense
      flat
      size="sm"
      @click="emit('edit-task', task.id)"
    >
      <q-tooltip :delay="0">Edit Task</q-tooltip>
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
      @click="emit('toggle-message-debug', task.id)"
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
    <q-btn
      v-if="state.appConfiguration.expertMode"
      class="col-auto"
      :icon="matSearch"
      dense
      flat
      size="sm"
      aria-label="show message in tree browser"
      :to="`/taskmanager?t=${task.id}`"
    >
      <q-tooltip :delay="0">Show similar tasks</q-tooltip>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import {
  matAltRoute,
  matCode,
  matContentCopy,
  matEdit,
  matRawOn,
  matSearch,
} from '@quasar/extras/material-icons'
import { mdiFileTree, mdiForumPlus, mdiLanguageMarkdown } from '@quasar/extras/mdi-v6'
import type { TaskNode } from 'src/modules/taskyon/types'
import { copyToClipboard } from 'src/modules/utils'
import { useAppStateStore } from 'src/stores/appState'

const state = useAppStateStore()

defineProps<{
  task: TaskNode
}>()

const emit = defineEmits<{
  (e: 'edit-task', taskId: string): Promise<void>
  (e: 'toggle-message-debug', taskId: string): void
  (e: 'toggle-markdown', taskId: string): void
  (e: 'create_new_conversation', taskId: string): Promise<void>
}>()
</script>
