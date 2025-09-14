<template>
  <div>
    <q-btn flat dense size="sm" :icon="matMoreHoriz">
      <q-menu auto-close>
        <q-list dense>
          <div class="row">
            <q-btn
              v-if="
                task.content.type === 'message' ||
                task.content.type === 'functioncall' ||
                task.content.type === 'tooldefinition'
              "
              class="col-4 col-sm"
              :icon="matEdit"
              dense
              flat
              @click="emit('edit-task', task.id)"
            >
              <div class="q-px-sm xs">Edit</div>
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
            <q-btn
              v-if="task.content.type === 'message' || task.content.type === 'functioncall'"
              class="col-4 col-sm"
              dense
              flat
              :icon="mdiForumPlus"
              @click="emit('create-new-conversation', task.id)"
            >
              <div class="q-px-sm xs">Start a new chat</div>
              <q-tooltip :delay="0">Start a new thread with this message! </q-tooltip>
            </q-btn>
            <q-btn
              v-if="state.appConfiguration.expertMode"
              class="col-4 col-sm"
              dense
              flat
              :icon="matAltRoute"
              @click="state.setSelectedTask(task.id)"
            >
              <div class="q-px-sm xs">Start alternative chat</div>
              <q-tooltip :delay="0"
                >Start alternative chat from here, keeping all previous messages up to this
                point.</q-tooltip
              >
            </q-btn>
            <q-btn
              class="col"
              :icon="matContentCopy"
              dense
              flat
              aria-label="copy markdown text"
              @click="
                copyToClipboard(
                  task.content.type === 'message'
                    ? task.content.data || ''
                    : JSON.stringify(task.content.data, null, 2),
                )
              "
            >
              <div class="q-px-sm xs">
                Copy {{ task.content.type === 'message' ? 'text (markdown)' : 'JSON' }}.
              </div>
              <q-tooltip :delay="0">
                Copy {{ task.content.type === 'message' ? 'text (markdown)' : 'JSON' }}.
              </q-tooltip>
            </q-btn>
          </div>
          <q-separator />
          <q-item
            v-if="state.appConfiguration.expertMode"
            clickable
            :to="`/taskmanager?t=${task.id}`"
          >
            <q-item-section side>
              <q-icon :name="matSearch"></q-icon>
            </q-item-section>
            <q-item-section> Show similar tasks </q-item-section>
          </q-item>
          <q-item
            v-if="task.content.type === 'message' && state.appConfiguration.expertMode"
            clickable
            @click="emit('toggle-markdown', task.id)"
          >
            <q-item-section side>
              <q-icon
                :name="
                  state.taskWidgetState[task.id]?.markdownEnabled != false
                    ? mdiLanguageMarkdown
                    : matRawOn
                "
              ></q-icon>
            </q-item-section>
            <q-item-section> Markdown on/off </q-item-section>
          </q-item>
          <q-separator v-if="state.appConfiguration.expertMode" vertical class="q-mx-sm" />
          <q-item
            v-if="state.appConfiguration.expertMode"
            clickable
            @click="emit('toggle-message-debug', task.id)"
          >
            <q-item-section side>
              <q-icon :name="matCode"></q-icon>
            </q-item-section>
            <q-item-section> Show detailed task view </q-item-section>
          </q-item>
          <q-item v-if="state.appConfiguration.expertMode" clickable :to="`/browser/${task.id}`">
            <q-item-section side>
              <q-icon :name="mdiFileTree"></q-icon>
            </q-item-section>
            <q-item-section> Show task tree </q-item-section>
          </q-item>
          <q-separator />
          <div class="row justify-around" clickable @click="emit('download', task.id)">
            <q-btn class="col" :icon="matDownload" dense flat @click="emit('download', task.id)">
              <div class="q-px-sm xs">Download Task</div>
              <q-tooltip :delay="0"> Download Task </q-tooltip>
            </q-btn>
            <q-btn class="col" :icon="matShare" dense flat @click="emit('share', task.id)">
              <div class="q-px-sm xs">Share Task</div>
              <q-tooltip :delay="0"> Share Task </q-tooltip>
            </q-btn>
            <q-btn class="col" :icon="matDelete" dense flat @click="emit('delete', task.id)">
              <div class="q-px-sm xs">Delete Task</div>
              <q-tooltip :delay="0"> Delete Task </q-tooltip>
            </q-btn>
          </div>
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
import type { TaskNode } from '@taskyon/taskyon'
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
