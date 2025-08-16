<template>
  <div>
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
      :icon="
        state.taskWidgetState[task.id]?.markdownEnabled != false ? mdiLanguageMarkdown : matRawOn
      "
      dense
      flat
      size="sm"
      @click="emit('toggle-markdown', task.id)"
    >
      <q-tooltip :delay="0">Markdown on/off</q-tooltip>
    </q-btn>
    <q-separator vertical class="q-mx-sm" />
    <q-btn
      v-if="task.content.type === 'message' || task.content.type === 'functioncall'"
      class="col-auto"
      size="sm"
      dense
      flat
      :icon="mdiForumPlus"
      @click="emit('create-new-conversation', task.id)"
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
      <q-tooltip :delay="0">
        Edit
        {{
          task.content.type === 'message'
            ? 'Message'
            : task.content.type === 'functioncall'
              ? 'Function Call'
              : 'Tool Definition'
        }}
      </q-tooltip>
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
    <q-btn flat dense size="sm" :icon="matMoreHoriz" @click.prevent.stop>
      <q-menu auto-close>
        <q-list dense>
          <q-item clickable @click="emit('download', task.id)">
            <q-item-section side>
              <q-icon :name="matDownload"></q-icon>
            </q-item-section>
            <q-item-section> Download </q-item-section>
          </q-item>
          <q-item clickable @click="emit('share', task.id)">
            <q-item-section side>
              <q-icon :name="matShare"></q-icon>
            </q-item-section>
            <q-item-section> Share </q-item-section>
          </q-item>
          <q-item clickable @click="emit('delete', task.id)">
            <q-item-section side>
              <q-icon :name="matDelete"></q-icon>
            </q-item-section>
            <q-item-section> Delete</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import {
  matAltRoute,
  matCode,
  matContentCopy,
  matDelete,
  matDownload,
  matEdit,
  matMoreHoriz,
  matRawOn,
  matSearch,
  matShare,
} from '@quasar/extras/material-icons'
import { mdiFileTree, mdiForumPlus, mdiLanguageMarkdown } from '@quasar/extras/mdi-v6'
import type { TaskNode } from '@taskyon/taskyon/types/node'
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
  (e: 'create-new-conversation', taskId: string): Promise<void>
  (e: 'delete', taskId: string): Promise<void>
  (e: 'download', taskId: string): Promise<void>
  (e: 'share', taskId: string): Promise<void>
}>()
</script>
