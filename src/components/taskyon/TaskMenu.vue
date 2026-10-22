<template>
  <q-list>
    <div class="row">
      <q-btn
        class="col q-pa-sm"
        :icon="matContentCopy"
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
        <q-tooltip :delay="0">
          Copy {{ task.content.type === 'message' ? 'text (markdown)' : 'JSON' }}.
        </q-tooltip>
      </q-btn>
      <q-btn
        v-if="task.content.type === 'message' || task.content.type === 'functioncall'"
        class="col"
        :icon="matEdit"
        flat
        @click="emit('edit-task', task.id)"
      >
        <q-tooltip :delay="0">
          Edit
          {{ task.content.type === 'message' ? 'Message' : 'Function Call' }}
        </q-tooltip>
      </q-btn>
      <q-btn
        v-if="task.content.type === 'message' || task.content.type === 'functioncall'"
        class="col"
        flat
        :icon="mdiForumPlus"
        @click="emit('create-new-conversation', task.id)"
      >
        <q-tooltip :delay="0">Start a new thread with this message! </q-tooltip>
      </q-btn>
      <q-btn
        v-if="state.appConfiguration.expertMode"
        class="col"
        flat
        :icon="matAltRoute"
        @click="navigateToTask(task.id)"
      >
        <q-tooltip :delay="0"
          >Start alternative chat from here, keeping all previous messages up to this
          point.</q-tooltip
        >
      </q-btn>
    </div>
    <q-separator v-if="state.appConfiguration.expertMode" />
    <q-item v-if="state.appConfiguration.expertMode" clickable :to="`/taskmanager?t=${task.id}`">
      <q-item-section side>
        <q-icon :name="matSearch"></q-icon>
      </q-item-section>
      <q-item-section> Show similar messages </q-item-section>
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
      <q-item-section> Detailed view </q-item-section>
    </q-item>
    <q-item v-if="state.appConfiguration.expertMode" clickable :to="`/browser/${task.id}`">
      <q-item-section side>
        <q-icon :name="mdiFileTree"></q-icon>
      </q-item-section>
      <q-item-section> Show task tree </q-item-section>
    </q-item>
    <q-separator v-if="state.appConfiguration.expertMode" />
    <q-item clickable data-cy="schedule-task" @click="openScheduleDialog">
      <q-item-section side>
        <q-icon :name="matSchedule" />
      </q-item-section>
      <q-item-section> Schedule task </q-item-section>
    </q-item>
    <q-separator v-if="state.appConfiguration.expertMode" />
    <div class="row justify-around" clickable @click="emit('download', task.id)">
      <q-btn class="col q-pa-sm" :icon="matDownload" flat @click="emit('download', task.id)">
        <q-tooltip :delay="0"> Download Task </q-tooltip>
      </q-btn>
      <q-btn class="col" :icon="matShare" flat @click="emit('share', task.id)">
        <q-tooltip :delay="0"> Share Task </q-tooltip>
      </q-btn>
      <q-btn class="col" :icon="matDelete" flat @click="emit('delete', task.id)">
        <q-tooltip :delay="0"> Delete Task </q-tooltip>
      </q-btn>
    </div>
  </q-list>
</template>

<script setup lang="ts">
import {
  matAltRoute,
  matCode,
  matContentCopy,
  matDelete,
  matDownload,
  matEdit,
  matRawOn,
  matSchedule,
  matSearch,
  matShare,
} from '@quasar/extras/material-icons'
import { mdiFileTree, mdiForumPlus, mdiLanguageMarkdown } from '@quasar/extras/mdi-v6'
import type { TaskNode } from '@taskyon/taskyon'
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { useQuasar } from 'quasar'
import { useTaskNavigation } from 'src/composables/useTaskNavigation'
import { useAppStateStore } from 'src/stores/appState'
import { computed } from 'vue'
import ScheduleTaskDialog from './ScheduleTaskDialog.vue'

const state = useAppStateStore()
const { navigateToTask } = useTaskNavigation()
const $q = useQuasar()

const props = defineProps<{
  task: TaskNode
}>()

const taskLabel = computed(() =>
  props.task.name ??
  (props.task.content.type === 'message'
    ? props.task.content.data.slice(0, 60)
    : props.task.content.type),
)

const openScheduleDialog = () => {
  $q.dialog({
    component: ScheduleTaskDialog,
    componentProps: {
      taskId: props.task.id,
      defaultLabel: taskLabel.value,
    },
  })
}

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
