<template>
  <TaskComposer
    v-model:file-attachments="fileAttachments"
    v-model:message-draft="state.messageDraft"
    v-model:create-task-type="state.createTaskType"
    v-model:draft-parameters="state.draftParameters"
    :client="taskyonClient"
    :current-task="tystate.currentTask.value"
    :selected-task-id="state.selectedTaskId"
    :entry-node="composerEntryNode"
    :all-tools="tystate.allTools"
    :min-mode="props.minMode"
    :expert-mode="props.expertMode"
    :hero-mode="props.heroMode"
    :use-enter-to-send="state.appConfiguration.useEnterToSend"
    :show-web-search="state.appConfiguration.webSearchButton"
    :navigate-to-task="navigateToTask"
    :mark-tasks-pending-creation="tystate.markTasksPendingCreation"
  >
    <template #settings>
      <SimpleSettingsDialog />
    </template>
    <template #model>
      <ChooseModelDialog class="create-tasks__model-control" />
    </template>
    <template #tool-manager-item>
      <q-item v-if="!selectedTaskType" clickable to="/tool" class="q-mb-md">
        <q-item-section avatar>
          <q-icon :name="mdiToolbox" />
        </q-item-section>
        <q-item-section>Open Tool Manager</q-item-section>
      </q-item>
    </template>
    <template #tool-link="{ toolName }">
      <q-btn
        v-if="state.appConfiguration.expertMode"
        flat
        dense
        size="sm"
        :icon="matBuild"
        :to="`/tool/${toolName}`"
      />
    </template>
  </TaskComposer>
</template>

<script setup lang="ts">
import { matBuild } from '@quasar/extras/material-icons'
import { mdiToolbox } from '@quasar/extras/mdi-v6'
import TaskComposer from '@taskyon/ui/components/taskyon/TaskComposer.vue'
import { partialTaskDraft } from '@taskyon/taskyon'
import { createTaskyonClient } from '@taskyon/tyclient'
import { useTaskNavigation } from 'src/composables/useTaskNavigation'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import type { ReadonlyDeep } from 'type-fest'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ChooseModelDialog from './ChooseModelDialog.vue'
import SimpleSettingsDialog from './SimpleSettingsDialog.vue'

const props = withDefaults(
  defineProps<{
    entryNode?: ReadonlyDeep<partialTaskDraft> | null
    minMode?: boolean
    expertMode?: boolean
    p2pTopic?: string
    heroMode?: boolean
    addToTaskyon?: boolean
  }>(),
  {
    minMode: false,
    expertMode: false,
    heroMode: false,
    entryNode: null,
    p2pTopic: '',
    addToTaskyon: false,
  },
)

const fileAttachments = defineModel<File[]>('fileAttachments', { default: () => [] })
const state = useAppStateStore()
const tystate = useTaskyonStore()
const taskyonClient = createTaskyonClient(tystate.api)
const { navigateToTask } = useTaskNavigation()
const selectedTaskType = computed(() =>
  state.createTaskType.type === 'functioncall' ? state.createTaskType.name : undefined,
)
const composerEntryNode = computed(() =>
  props.entryNode ? partialTaskDraft.parse(structuredClone(props.entryNode)) : undefined,
)

onMounted(() => {
  state.setDraftPasteHandler((pastedFiles) => {
    fileAttachments.value.push(...pastedFiles)
  })
})

onBeforeUnmount(() => {
  state.setDraftPasteHandler(null)
})
</script>

<style>
.create-tasks--hero {
  width: 100%;
}

.create-tasks--hero .ty-msg-edit {
  min-height: 4.5rem;
}

.create-tasks--hero .ty-msg-edit .q-field__control {
  min-height: 4.5rem;
}

.create-tasks--hero .ty-msg-edit textarea {
  padding-top: 1rem;
  font-size: 1.06rem;
  line-height: 1.5;
}

@media (max-width: 560px) {
  .create-tasks--hero .ty-msg-edit {
    min-height: 3.6rem;
  }

  .create-tasks--hero .ty-msg-edit .q-field__control {
    min-height: 3.6rem;
  }

  .create-tasks--hero .ty-msg-edit textarea {
    padding-top: 0.85rem;
    font-size: 1rem;
    line-height: 1.45;
  }
}

.model-history .ellipsis {
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
